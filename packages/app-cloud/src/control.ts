/**
 * The extension's control entry (ADR-0017) — the only place @prisma/alchemy
 * is imported. Loaded ONLY by `prisma-app.config.ts` (never by app code);
 * deploy-time only; never lands in a runtime bundle. `prismaCloud()` reads
 * and validates its own environment at construction — config evaluation —
 * so a missing variable fails before any assembly work, naming the variable.
 *
 * Each node kind's control lives in its own module under `src/controls/`;
 * this file only resolves options, provisions the application, merges the
 * providers, and routes node types to their controls.
 */

import * as Prisma from '@prisma/alchemy';
import type { ExtensionDescriptor } from '@prisma/app/config';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { computeControl } from './controls/compute.ts';
import { postgresControl } from './controls/postgres.ts';
import { prismaNextControl } from './controls/prisma-next.ts';
import { type ResolvedCloudOptions, validateName } from './controls/shared.ts';
import { PgWarmProvider } from './pg-warm-resource.ts';
import { PnMigrationProvider } from './pn-migration-resource.ts';

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

/** Resolves the factory's env-or-option inputs, failing fast with the exact variable name (construction runs during config evaluation). */
function resolveOptions(opts: PrismaCloudOptions): ResolvedCloudOptions {
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

  return {
    id: '@prisma/app-cloud',

    // Alchemy's Stack types its providers Layer against the per-resource
    // requirements inferred from the stack effect, which the ProviderCollection
    // returned by Prisma.providers() does not structurally unify with — a
    // pre-existing typings gap in @prisma/alchemy. It satisfies them at runtime;
    // this is the one commented cast, and it lives in the extension, not core.
    providers: () =>
      Layer.mergeAll(
        Prisma.providers(),
        PgWarmProvider(),
        PnMigrationProvider(),
      ) as unknown as Layer.Layer<never>,

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
      postgres: postgresControl(o),
      'prisma-next': prismaNextControl(o),
      compute: computeControl(o),
    },
  };
};
