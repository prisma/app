/**
 * The lowering table — the only place @makerkit/prisma-alchemy is imported.
 * Deploy-time only; never lands in a runtime bundle.
 */

import type { ServiceNode } from '@makerkit/core';
import { configOf } from '@makerkit/core';
import type { Target } from '@makerkit/core/deploy';
import * as Prisma from '@makerkit/prisma-alchemy';
import { prismaState } from '@makerkit/prisma-alchemy/state';
import * as Output from 'alchemy/Output';
import * as Effect from 'effect/Effect';
import type * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';
import { configKey } from './serializer.ts';

export interface PrismaCloudOptions {
  workspaceId: string;
  region?: Prisma.ComputeRegion;
}

export const prismaCloud = (o: PrismaCloudOptions): Target => ({
  name: 'prisma-cloud',

  // Alchemy's Stack types its providers Layer against the per-resource
  // requirements inferred from the stack effect, which the ProviderCollection
  // returned by Prisma.providers() does not structurally unify with — a
  // pre-existing typings gap in prisma-alchemy. It satisfies them at runtime;
  // this is the one commented cast, and it lives in the pack, not core.
  providers: () => Prisma.providers() as unknown as Layer.Layer<never>,

  // Hosted state is the default for this target: any deployer with a service
  // token and the workspace id shares the same state, killing the
  // duplicate-stack footgun of untracked local `.alchemy/` files. An explicit
  // opts.state (e.g. CI's ephemeral runs) still overrides this.
  state: () => prismaState({ workspaceId: o.workspaceId }),

  // Runs ONCE per lowering, before any service: the application's Project,
  // with the poison DATABASE_URL/DATABASE_URL_POOLED variables written
  // immediately so nothing can ever rely on the platform default.
  application: {
    provision: ({ opts }) =>
      Effect.gen(function* () {
        const project = yield* Prisma.Project(`${opts.name}-project`, {
          workspaceId: o.workspaceId,
          name: opts.name,
        });
        for (const key of ['DATABASE_URL', 'DATABASE_URL_POOLED']) {
          yield* Prisma.EnvironmentVariable(`${key}-poison`, {
            projectId: project.id,
            key,
            // "-", not "": the API rejects empty env-var values with
            // "String must contain at least 1 character" (verified at the R4
            // deploy proof). Any garbage value fails a real connect loudly.
            value: '-',
            class: 'production',
          });
        }
        return { outputs: { projectId: project.id } };
      }),
  },

  resources: {
    // Each postgres input gets its own Database in the application's project.
    // The url output fills the service's db.url Config leaf and is encoded by
    // serialize under the service's own named key — never the platform default.
    'prisma-cloud/postgres': ({ id, application }) =>
      Effect.gen(function* () {
        const db = yield* Prisma.Database(`${id}-db`, {
          projectId: application.outputs['projectId'] as string,
          name: id,
          region: o.region ?? 'us-east-1',
        });
        const conn = yield* Prisma.Connection(`${id}-conn`, { databaseId: db.id, name: id });
        const url = Output.map(conn.connectionString, (value) => Redacted.value(value));
        return { outputs: { url } };
      }),
  },

  services: {
    'prisma-cloud/compute': {
      // The service as a PLACE inside the application's Project: the App,
      // identity-bearing only, no code runs.
      provision: ({ id, application }) =>
        Effect.gen(function* () {
          const svc = yield* Prisma.ComputeService(`${id}-svc`, {
            projectId: application.outputs['projectId'] as string,
            name: id,
            region: o.region ?? 'us-east-1',
          });
          return { outputs: { serviceId: svc.id, projectId: application.outputs['projectId'] } };
        }),

      // Encode the typed Config into the runtime environment — one env var
      // per leaf, keyed by the SAME serializer run() reads at boot
      // (serializer.ts, shared both directions). Values are the provisioning refs
      // core built the Config from, so each env var depends on its
      // resource/producer — the ordering edges. class production; the
      // platform default is never written.
      serialize: ({ address, node }, provisioned, config) =>
        Effect.gen(function* () {
          const records = [];
          for (const d of configOf(node as ServiceNode)) {
            const value =
              d.owner === 'service'
                ? config.service[d.name]
                : config.inputs[d.owner.input]?.[d.name];
            const key = configKey(address, d);
            records.push(
              yield* Prisma.EnvironmentVariable(`${key}-var`, {
                projectId: provisioned.outputs['projectId'] as string,
                key,
                // encode typed→string: a concrete leaf stringifies; a provisioning
                // ref (already string-typed) passes through and carries the edge.
                value: typeof value === 'number' ? String(value) : (value as never),
                class: 'production',
              }),
            );
          }
          return { outputs: { environment: records } };
        }),

      // Print the bootstrap (address + boot import baked in) and assemble the
      // deployable artifact from the build adapter's normalized dir: bootstrap.js
      // + compute.manifest.json beside the wrapper + the app's entry,
      // deterministic tar.gz (fixed mtimes/ordering so unchanged inputs hash
      // identically). The actual fs/tar work lives in prisma-alchemy — this
      // pack's shipped src imports no node:/bun API (invariant 5).
      package: ({ id }, { assembled, address }) =>
        Effect.try(() =>
          Prisma.packageComputeArtifact({
            id,
            bundleDir: assembled.dir,
            appEntry: assembled.entry,
            address,
          }),
        ),

      // A specific BUILD into the place: version → upload → start → promote.
      // The environment prop references serialize's env-var records, so the
      // version depends on them (the edge that kills PRO-211 + propagates
      // change). deployedUrl is read post-promote — the create-time domain is
      // a placeholder (PRO-200).
      deploy: ({ id }, provisioned, artifact, serialized) =>
        Effect.gen(function* () {
          const deployment = yield* Prisma.Deployment(`${id}-deploy`, {
            computeServiceId: provisioned.outputs['serviceId'] as string,
            artifactPath: artifact.path,
            artifactHash: artifact.sha256,
            environment: serialized.outputs['environment'] as readonly Prisma.EnvironmentVariable[],
            port: 3000,
          });
          return {
            outputs: { url: deployment.deployedUrl, projectId: provisioned.outputs['projectId'] },
          };
        }),
    },
  },
});
