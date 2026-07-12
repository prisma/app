/**
 * Helpers shared by the per-node-kind controls under `src/controls/` and the
 * extension factory in `control.ts`. Deploy-time only — reachable exclusively
 * through the `./control` entry, never from the authoring barrel.
 */

import type * as Prisma from '@prisma/alchemy';
import { blindCast } from '@prisma/app/casts';

/** The factory's resolved options each node control closes over. */
export interface ResolvedCloudOptions {
  readonly workspaceId: string;
  readonly region?: Prisma.ComputeRegion;
}

/** Where a resource lands when the deploy names no region. */
export const DEFAULT_REGION: Prisma.ComputeRegion = 'us-east-1';

// Prisma's Connection create constrains `name` to 3–65 chars (Management API:
// POST /v1/connections); applied here to every id-derived resource name as the
// tightest of the API's name-length rules.
const PRISMA_NAME_MIN = 3;
const PRISMA_NAME_MAX = 65;

export function validateName(value: string, source: string): void {
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
export const projectIdOf = (hook: {
  readonly outputs: Readonly<Record<string, unknown>>;
}): string =>
  blindCast<
    string,
    'the projectId output is a provisioning string ref the application hook produced; LoweredNode.outputs is typed unknown'
  >(hook.outputs['projectId']);
