/** Helpers shared by the per-node-kind descriptors under `src/descriptors/` and the extension factory in `control.ts`. */

import { blindCast } from '@internal/foundation/casts';
import type * as Prisma from '@internal/lowering';
import type * as Output from 'alchemy/Output';

/**
 * How one brand's provisioned values land on a PROVIDER (ADR-0031: "the
 * provisioner owns mint, size, **aggregation**, stability, and rotation", and
 * ADR-0019: the physical landing — which env var, what encoding — is the
 * target's). Given every inbound edge's minted ref for one provider, a landing
 * returns the single env row to write: its reserved name and its aggregated
 * value.
 *
 * This is the seam that keeps `descriptors/compute.ts` brand-blind. A landing
 * is registered beside its brand's provisioner in `control.ts`; compute asks
 * every registered landing about every exposing service and writes whatever
 * comes back — returning `undefined` writes no row.
 */
export type ProvisionLanding = (input: {
  /** The provider's deployment address — the landing scopes its env name to it. */
  readonly address: string;
  /**
   * Every inbound edge's minted ref for this provider — POSSIBLY EMPTY. A
   * provider with no wired consumers is still asked, because "no edges" and
   * "no var" mean different things at boot: an absent var reads as "never
   * provisioned" (local dev, tests). What an empty set means is the brand's
   * own call — deny everything, or emit nothing and let its reader fail closed.
   */
  readonly refs: readonly unknown[];
}) =>
  | {
      readonly key: string;
      /** A resolved literal (e.g. a zero-consumer deny value) or an Output the deploy resolves. */
      readonly value: Output.Output<string> | string;
    }
  | undefined;

/**
 * The factory's resolved options each node descriptor closes over. `projectId`
 * and `branchId` come from the CLI (stage-as-branch): a named stage sets
 * `branchId`, routing every branch-scoped resource there with the `preview` class.
 */
export interface ResolvedCloudOptions {
  readonly workspaceId: string;
  readonly region?: Prisma.ComputeRegion;
  readonly projectId: string | undefined;
  readonly branchId: string | undefined;
  /**
   * This extension's provider-side landings, keyed by need brand — the mirror
   * of the `provisions` registry core resolves mints through. Passed as data so
   * the descriptors never import a brand's module (and so control.ts, which
   * owns both registries, stays the only place a brand is named).
   */
  readonly provisionLandings: ReadonlyMap<symbol, ProvisionLanding>;
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

/** The application/provisioned hook's `projectId` output — `LoweredNode.outputs` is typed `unknown`, so this is the one asserted read. */
export const projectIdOf = (hook: {
  readonly outputs: Readonly<Record<string, unknown>>;
}): string =>
  blindCast<
    string,
    'the projectId output is a provisioning string ref the application hook produced; LoweredNode.outputs is typed unknown'
  >(hook.outputs['projectId']);
