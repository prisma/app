/**
 * The `PnMigration` Alchemy resource wiring (slice 2 D2), proven WITHOUT Prisma
 * Cloud:
 *   - the descriptor-level provider merge resolves the resource — the open
 *     question: `Layer.merge(Prisma.providers(), PnMigrationProvider())` makes
 *     Alchemy find the `PnMigration` provider (direct provider-tag lookup, no
 *     `@prisma/alchemy` change), and merging does not shadow the Prisma
 *     providers. Resolved through a scoped `Layer.build` + `provideContext`
 *     (stable public Effect API), not `Effect.provide(layer)`'s internals;
 *   - the provider's `reconcile` routes to `applyPnMigration` — driven directly
 *     against the exported provider service (no layer building), proven live
 *     against a real local Postgres (empty → init, re-run → no-op, no-path →
 *     rejects). The full merge is proven end to end by the live E2E deploy.
 *
 * Self-isolating: the reconcile suite resets the DB in `beforeAll` so it starts
 * clean in a shared CI Postgres (any test order).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as Prisma from '@prisma/alchemy';
import * as Provider from 'alchemy/Provider';
import type * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import { PnMigrationProvider, pnMigrationProviderService } from '../pn-migration-resource.ts';
import { PnMigrationError, targetStorageHash } from '../prisma-next-migrate.ts';
import gadgetContractJson from './fixtures/gadget-contract/emitted/contract.json' with {
  type: 'json',
};
import widgetContractJson from './fixtures/widget-contract/emitted/contract.json' with {
  type: 'json',
};
import { resetDatabase, startTestPostgres, type TestPostgres } from './postgres-harness.ts';

// Prisma.providers() reads PRISMA_SERVICE_TOKEN at layer-build (Layer.orDie).
// Building the layer to resolve a provider TAG makes no API call — a placeholder
// token is enough; nothing here contacts Prisma Cloud.
process.env['PRISMA_SERVICE_TOKEN'] ??= 'test-token-not-used';

const descriptorMerged = Layer.merge(Prisma.providers(), PnMigrationProvider());

// Resolve a value from the built merged-provider context, using only stable
// public Effect APIs: build the layer inside a scope, then provide the resulting
// Context to the lookup. Avoids `Effect.provide(layer)`, whose internal
// `layer.build(...)` handling proved fragile across environments.
const resolveInMerged = <A>(lookup: Effect.Effect<A, never, never>): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Layer.build(descriptorMerged).pipe(
        Effect.flatMap((context: Context.Context<never>) => Effect.provideContext(lookup, context)),
      ),
    ),
  );

describe('PnMigration provider merge (descriptor-level, no @prisma/alchemy change)', () => {
  test('the merged layer resolves the PnMigration provider by type', async () => {
    const resolved = await resolveInMerged(Provider.tryFindProviderByType('PrismaNext.Migration'));
    expect(Option.isSome(resolved)).toBe(true);
  });

  test('merging does not shadow the Prisma providers (Database still resolves)', async () => {
    const resolved = await resolveInMerged(Provider.tryFindProviderByType('Prisma.Database'));
    expect(Option.isSome(resolved)).toBe(true);
  });
});

const pg: TestPostgres | undefined = startTestPostgres();

if (pg === undefined) {
  console.warn(
    '[app-cloud] skipping PnMigration reconcile test: no Postgres available. ' +
      'Set STATE_TEST_DATABASE_URL or install initdb/pg_ctl on PATH.',
  );
}

describe.skipIf(pg === undefined)('PnMigration reconcile routes through applyPnMigration', () => {
  if (pg === undefined) return;
  const url = pg.url;
  let migrationsDir: string;

  // Drive the reconcile through the exported provider service directly — no
  // Effect layer to build, so the routing assertion can't be flaked by
  // environment-specific layer internals.
  const reconcile = (contractJson: unknown) =>
    pnMigrationProviderService.reconcile({
      id: 'db',
      instanceId: 'db',
      news: { url, contractJson, migrationsDir, targetHash: targetStorageHash(contractJson) },
      olds: undefined,
      output: undefined,
      // The plan session / bindings are unused by this provider's reconcile.
      session: undefined as never,
      bindings: undefined as never,
    });

  beforeAll(async () => {
    migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-app-pn-res-'));
    await resetDatabase(url);
  });
  afterAll(() => {
    pg.stop();
    if (migrationsDir !== undefined) fs.rmSync(migrationsDir, { recursive: true, force: true });
  });

  test('reconcile applies the contract then no-ops on the resolved props', async () => {
    const targetHash = targetStorageHash(widgetContractJson);
    const first = await Effect.runPromise(reconcile(widgetContractJson));
    expect(first.storageHash).toBe(targetHash);
    const second = await Effect.runPromise(reconcile(widgetContractJson));
    expect(second.storageHash).toBe(targetHash);
  });

  test('reconcile re-throws a no-path failure: the Effect REJECTS with PnMigrationError', async () => {
    // Ensure the DB is signed at widgetHash (idempotent if already there).
    await Effect.runPromise(reconcile(widgetContractJson));

    // Target a DIFFERENT contract (gadget) with no authored migration path. The
    // provider's `catch: (e) => e` must route the thrown PnMigrationError into
    // the Effect's error channel — so the reconcile FAILS, not succeeds.
    const outcome = await Effect.runPromise(
      reconcile(gadgetContractJson).pipe(
        Effect.match({
          onSuccess: () => ({ failed: false as const, error: undefined }),
          onFailure: (error: unknown) => ({ failed: true as const, error }),
        }),
      ),
    );

    expect(outcome.failed).toBe(true);
    expect(outcome.error).toBeInstanceOf(PnMigrationError);
    expect((outcome.error as PnMigrationError).code).toBe('MIGRATION_PATH_NOT_FOUND');
  });
});
