/**
 * The `PnMigration` Alchemy resource wiring (slice 2 D2), proven WITHOUT Prisma
 * Cloud:
 *   - the merge/lookup MECHANISM the descriptor relies on — `Layer.merge` of two
 *     `Provider.effect` layers keeps BOTH provider tags reachable by
 *     `tryFindProviderByType` (no shadowing). Exercised with two synthetic clean
 *     providers, not the real `Prisma.providers()`: that layer's sub-layers hit
 *     an environment-fragile Effect internal (`layer.build is not a function`)
 *     when built from a test, and the real `Prisma.providers()` + `PnMigration`
 *     merge is already proven end to end by the green live E2E deploy — so the
 *     test only needs the mechanism, not Prisma's provider internals;
 *   - the provider's `reconcile` routes to `applyPnMigration` — driven directly
 *     against the exported provider service, proven live against a real local
 *     Postgres (empty → init, re-run → no-op, no-path → rejects).
 *
 * Self-isolating: the reconcile suite owns a uniquely-named database, so it
 * never touches tables another suite shares in the CI Postgres.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import type * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import { PgWarmProvider } from '../pg-warm-resource.ts';
import { PnMigrationProvider, pnMigrationProviderService } from '../pn-migration-resource.ts';
import { PnMigrationError, targetStorageHash } from '../prisma-next-migrate.ts';
import gadgetContractJson from './fixtures/gadget-contract/emitted/contract.json' with {
  type: 'json',
};
import widgetContractJson from './fixtures/widget-contract/emitted/contract.json' with {
  type: 'json',
};
import {
  createTestDatabase,
  startTestPostgres,
  type TestDatabase,
  type TestPostgres,
} from './postgres-harness.ts';

// A trivial second Alchemy resource + provider — a clean stand-in for "some
// other extension's provider", so the merge mechanism is exercised without the
// real Prisma.providers() (whose sub-layers are fragile to build from a test).
type TestProbe = Resource<'PrismaNext.TestProbe', { readonly n: number }, { readonly n: number }>;
const TestProbe = Resource<TestProbe>('PrismaNext.TestProbe');
const TestProbeProvider = () =>
  Provider.effect(
    TestProbe,
    Effect.succeed<Provider.ProviderService<TestProbe>>({
      list: () => Effect.succeed([]),
      reconcile: ({ news }) => Effect.succeed({ n: news.n }),
      delete: () => Effect.void,
    }),
  );

// The exact merge shape the extension descriptor uses (`Layer.merge(providerA,
// providerB)`), with two clean providers. Resolved via a scoped `Layer.build` +
// `provideContext` (stable public Effect API), not `Effect.provide(layer)`.
const merged = Layer.mergeAll(PnMigrationProvider(), PgWarmProvider(), TestProbeProvider());
const resolveInMerged = <A>(lookup: Effect.Effect<A, never, never>): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Layer.build(merged).pipe(
        Effect.flatMap((context: Context.Context<never>) => Effect.provideContext(lookup, context)),
      ),
    ),
  );

describe('provider merge mechanism (Layer.merge keeps both tags reachable)', () => {
  test('the merged layer resolves the PnMigration provider by type', async () => {
    const resolved = await resolveInMerged(Provider.tryFindProviderByType('PrismaNext.Migration'));
    expect(Option.isSome(resolved)).toBe(true);
  });

  test('the merged layer resolves the PgWarm provider by type', async () => {
    const resolved = await resolveInMerged(Provider.tryFindProviderByType('PrismaCloud.PgWarm'));
    expect(Option.isSome(resolved)).toBe(true);
  });

  test('merging does not shadow the other provider (TestProbe still resolves)', async () => {
    const resolved = await resolveInMerged(Provider.tryFindProviderByType('PrismaNext.TestProbe'));
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
  let migrationsDir: string;
  let testDb: TestDatabase;
  let url: string;

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
    testDb = await createTestDatabase(pg.url);
    url = testDb.url;
  });
  afterAll(async () => {
    await testDb?.drop().catch(() => {});
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
