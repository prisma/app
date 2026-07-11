/**
 * The extension's control entry (ADR-0017) — the only place @prisma/alchemy
 * is imported. Loaded ONLY by `prisma-app.config.ts` (never by app code);
 * deploy-time only; never lands in a runtime bundle. `prismaCloud()` reads
 * and validates its own environment at construction — config evaluation —
 * so a missing variable fails before any assembly work, naming the variable.
 */

import * as Prisma from '@prisma/alchemy';
import type { ServiceNode } from '@prisma/app';
import { blindCast } from '@prisma/app/casts';
import type { ExtensionDescriptor } from '@prisma/app/config';
import type { Lowering } from '@prisma/app/deploy';
import * as Output from 'alchemy/Output';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Redacted from 'effect/Redacted';
import { resolveMigrationsDir } from './pn-config.ts';
import { PnMigration, PnMigrationProvider } from './pn-migration-resource.ts';
import { isPnPostgresResourceNode } from './prisma-next.ts';
import { targetStorageHash } from './prisma-next-migrate.ts';
import { configKey, encode, paramEntries } from './serializer.ts';

/** The Prisma Cloud–hosted deploy state store; its implementation lives in @prisma/alchemy. */
export { prismaState } from '@prisma/alchemy/state';

export interface PrismaCloudOptions {
  /** Defaults to the PRISMA_WORKSPACE_ID environment variable. */
  workspaceId?: string;
  /** Defaults to the PRISMA_REGION environment variable when set. */
  region?: Prisma.ComputeRegion;
}

// Prisma.COMPUTE_REGIONS is the runtime source of truth ComputeRegion is
// derived from, so this can never fall behind — no hand-maintained list, no
// exhaustiveness gymnastics to keep it honest.
const KNOWN_REGION_SET: ReadonlySet<string> = new Set(Prisma.COMPUTE_REGIONS);

function isComputeRegion(value: string): value is Prisma.ComputeRegion {
  return KNOWN_REGION_SET.has(value);
}

// Prisma's Connection create constrains `name` to 3–65 chars (Management API:
// POST /v1/connections); applied here to every id-derived resource name as the tightest of the API's name-length rules.
const PRISMA_NAME_MIN = 3;
const PRISMA_NAME_MAX = 65;

function validateName(value: string, source: string): void {
  if (value.length < PRISMA_NAME_MIN || value.length > PRISMA_NAME_MAX) {
    throw new Error(
      `prisma-cloud: ${source} "${value}" (${value.length} characters) is not a valid Prisma ` +
        `resource name — Prisma requires ${PRISMA_NAME_MIN}–${PRISMA_NAME_MAX} characters. ` +
        'Rename the provision id (or the deploy --name) to fit.',
    );
  }
}

/**
 * The application/provisioned hook's `projectId` output — a provisioning string
 * ref. `LoweredNode.outputs` is typed `unknown` (core never inspects an
 * extension's outputs), so this is the one asserted read, named once here
 * instead of a bare cast per call site.
 */
const projectIdOf = (hook: { readonly outputs: Readonly<Record<string, unknown>> }): string =>
  blindCast<
    string,
    'the projectId output is a provisioning string ref the application hook produced; LoweredNode.outputs is typed unknown'
  >(hook.outputs['projectId']);

/** Resolves the factory's env-or-option inputs, failing fast with the exact variable name (construction runs during config evaluation). */
function resolveOptions(opts: PrismaCloudOptions): {
  workspaceId: string;
  region?: Prisma.ComputeRegion;
} {
  const workspaceId = opts.workspaceId ?? process.env['PRISMA_WORKSPACE_ID'];
  if (workspaceId === undefined || workspaceId.length === 0) {
    throw new Error('prismaCloud(): environment variable PRISMA_WORKSPACE_ID is required.');
  }

  if (opts.region !== undefined) return { workspaceId, region: opts.region };

  const region = process.env['PRISMA_REGION'];
  if (region === undefined || region.length === 0) {
    return { workspaceId };
  }
  if (!isComputeRegion(region)) {
    throw new Error(
      `prismaCloud(): environment variable PRISMA_REGION="${region}" is not a known region ` +
        `(expected one of: ${Prisma.COMPUTE_REGIONS.join(', ')}).`,
    );
  }
  return { workspaceId, region };
}

/** The Prisma Cloud extension descriptor — `prisma-app.config.ts` lists it under `extensions`. */
export const prismaCloud = (opts: PrismaCloudOptions = {}): ExtensionDescriptor => {
  const o = resolveOptions(opts);

  // One Database per system-provisioned postgres resource, in the application's
  // project — `id` is the system provision id (e.g. "db"), so a resource shared
  // by several consumers is created exactly once. The url output fills each
  // consumer's Config leaf and is encoded by serialize under that service's
  // own named key — never the platform default.
  const postgresLowering: Lowering = ({ id, application }) =>
    Effect.gen(function* () {
      validateName(id, 'resource name (from provision id)');
      const db = yield* Prisma.Database(`${id}-db`, {
        projectId: projectIdOf(application),
        name: id,
        region: o.region ?? 'us-east-1',
      });
      const conn = yield* Prisma.Connection(`${id}-conn`, { databaseId: db.id, name: id });
      const url = Output.map(conn.connectionString, (value) => Redacted.value(value));
      return { outputs: { url } };
    });

  // A prisma-next resource is a Prisma Postgres DB (provisioned exactly like
  // `postgres`) PLUS a migration step that brings the live DB to the contract's
  // storageHash. The migration is a tracked `PnMigration` Alchemy resource keyed
  // on the target hash, so it participates in deploy state: unchanged redeploy is
  // a no-op, a contract change re-migrates, a failed apply leaves the DB
  // unchanged. `node` carries the config path (D1's `isPnPostgresResourceNode`)
  // and the contract (`provides`); the config is read at deploy-time only.
  const prismaNextLowering: Lowering = ({ id, node, application }) =>
    Effect.gen(function* () {
      validateName(id, 'resource name (from provision id)');
      const db = yield* Prisma.Database(`${id}-db`, {
        projectId: projectIdOf(application),
        name: id,
        region: o.region ?? 'us-east-1',
      });
      const conn = yield* Prisma.Connection(`${id}-conn`, { databaseId: db.id, name: id });
      const url = Output.map(conn.connectionString, (value) => Redacted.value(value));

      if (!isPnPostgresResourceNode(node)) {
        // The registry routes 'prisma-next'-typed resource nodes here, so this
        // is unreachable — but narrow explicitly rather than cast to read config.
        throw new Error(`prisma-next lowering received a non-prisma-next node (${id}).`);
      }
      const contractJson = node.provides.__cmp.contractJson;
      const targetHash = targetStorageHash(contractJson);
      const migrationsDir = yield* Effect.promise(() => resolveMigrationsDir(node.config));

      // Register the migration as a tracked resource — its provider's reconcile
      // receives the RESOLVED url at apply-time and runs the authored migration.
      yield* PnMigration(`${id}-migrate`, { url, contractJson, migrationsDir, targetHash });

      return { outputs: { url } };
    });

  return {
    id: '@prisma/app-cloud',

    // Alchemy's Stack types its providers Layer against the per-resource
    // requirements inferred from the stack effect, which the ProviderCollection
    // returned by Prisma.providers() does not structurally unify with — a
    // pre-existing typings gap in @prisma/alchemy. It satisfies them at runtime;
    // this is the one commented cast, and it lives in the extension, not core.
    providers: () =>
      Layer.merge(Prisma.providers(), PnMigrationProvider()) as unknown as Layer.Layer<never>,

    // Runs ONCE per lowering, before any service: the application's Project,
    // with the poison DATABASE_URL/DATABASE_URL_POOLED variables written
    // immediately so nothing can ever rely on the platform default.
    application: {
      provision: ({ opts: lowerOpts }) =>
        Effect.gen(function* () {
          validateName(lowerOpts.name, 'application name');
          const project = yield* Prisma.Project(`${lowerOpts.name}-project`, {
            workspaceId: o.workspaceId,
            name: lowerOpts.name,
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

    nodes: {
      postgres: Object.assign(postgresLowering, { kind: 'resource' as const }),

      'prisma-next': Object.assign(prismaNextLowering, { kind: 'resource' as const }),

      compute: {
        kind: 'service' as const,
        // The service as a PLACE inside the application's Project: the App,
        // identity-bearing only, no code runs.
        provision: ({ id, application }) =>
          Effect.gen(function* () {
            validateName(id, 'service name (from provision id)');
            const svc = yield* Prisma.ComputeService(`${id}-svc`, {
              projectId: projectIdOf(application),
              name: id,
              region: o.region ?? 'us-east-1',
            });
            return {
              outputs: { serviceId: svc.id, projectId: application.outputs['projectId'] },
            };
          }),

        // Encodes the typed Config into env vars, keyed by the same serializer run() reads at boot.
        // `encode` does the typed→string mapping — LANDMINE: a dependency-input
        // `url`'s value may be a provisioning ref at deploy, not a literal
        // string; `encode` passes a dependency-input value through untouched
        // (never stringified) so it keeps carrying the ordering edge. Only
        // service-own literals (e.g. `port`) are ever actually encoded.
        serialize: ({ address, node }, provisioned, config) =>
          Effect.gen(function* () {
            const records = [];
            for (const d of paramEntries(node as ServiceNode)) {
              const value =
                d.owner === 'service'
                  ? config.service[d.name]
                  : config.inputs[d.owner.input]?.[d.name];
              const key = configKey(address, d);
              records.push(
                yield* Prisma.EnvironmentVariable(`${key}-var`, {
                  projectId: projectIdOf(provisioned),
                  key,
                  value: encode(d.owner, value),
                  class: 'production',
                }),
              );
            }
            // Carries the resolved port to deploy() via serialize's outputs; falls back to 3000 if unset.
            const port = typeof config.service['port'] === 'number' ? config.service['port'] : 3000;
            return { outputs: { environment: records, port } };
          }),

        // Print the bootstrap (address + boot import baked in) and assemble the
        // deployable artifact from the build control's normalized dir:
        // bootstrap.js + compute.manifest.json beside the wrapper + the app's
        // entry, deterministic tar.gz (fixed mtimes/ordering so unchanged
        // inputs hash identically). The actual fs/tar work lives in
        // @prisma/alchemy — this extension's shipped src imports no node:/bun
        // API (invariant 5).
        package: ({ id }, { assembled, address }) =>
          Effect.try(() =>
            Prisma.packageComputeArtifact({
              id,
              bundleDir: assembled.dir,
              appEntry: assembled.entry,
              address,
            }),
          ),

        // The environment prop references serialize's env-var records, so the deploy depends on them.
        deploy: ({ id }, provisioned, artifact, serialized) =>
          Effect.gen(function* () {
            const deployment = yield* Prisma.Deployment(`${id}-deploy`, {
              computeServiceId: provisioned.outputs['serviceId'] as string,
              artifactPath: artifact.path,
              artifactHash: artifact.sha256,
              environment: serialized.outputs[
                'environment'
              ] as readonly Prisma.EnvironmentVariable[],
              // Route to the port the app actually binds (the service's `port`
              // param, resolved by serialize) — not a hardcoded constant.
              port:
                typeof serialized.outputs['port'] === 'number' ? serialized.outputs['port'] : 3000,
            });
            return {
              outputs: { url: deployment.deployedUrl, projectId: provisioned.outputs['projectId'] },
            };
          }),
      },
    },
  };
};
