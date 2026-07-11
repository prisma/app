/**
 * The safety-critical migration decision + apply logic (slice 2 D2), proven
 * against a real local Postgres — isolated from the Alchemy stack / Prisma
 * Cloud provisioning (that path is unchanged from bare `postgres` and proven
 * live in slice 1). Exercises `applyPnMigration` end to end:
 *   - empty DB          → `init` (dbInit applies + signs the target marker)
 *   - same hash re-run  → `noop`
 *   - no authored path   → throws PnMigrationError(MIGRATION_PATH_NOT_FOUND),
 *                          DB left unchanged
 *
 * Schema/marker setup uses PN's control client directly (the same machinery the
 * lowering drives). Environment-gated via the shared harness: skips cleanly
 * without a local Postgres, runs on CI against the wired service.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createPostgresControlClient } from '@prisma-next/postgres/control';
import { applyPnMigration, PnMigrationError, targetStorageHash } from '../prisma-next-migrate.ts';
import gadgetContractJson from './fixtures/gadget-contract/emitted/contract.json' with {
  type: 'json',
};
import widgetContractJson from './fixtures/widget-contract/emitted/contract.json' with {
  type: 'json',
};
import { startTestPostgres, type TestPostgres } from './postgres-harness.ts';

const pg: TestPostgres | undefined = startTestPostgres();

if (pg === undefined) {
  console.warn(
    '[app-cloud] skipping prisma-next migrate integration test: no Postgres available. ' +
      'Set STATE_TEST_DATABASE_URL or install initdb/pg_ctl on PATH.',
  );
}

const widgetHash = targetStorageHash(widgetContractJson);
const gadgetHash = targetStorageHash(gadgetContractJson);

async function readMarkerHash(url: string): Promise<string | null> {
  const client = createPostgresControlClient({ connection: url });
  await client.connect();
  try {
    const marker = await client.readMarker();
    return marker?.storageHash ?? null;
  } finally {
    await client.close();
  }
}

describe.skipIf(pg === undefined)('applyPnMigration — live against real Postgres', () => {
  if (pg === undefined) return;
  const url = pg.url;
  // An empty migrations dir: dbInit synthesizes the additive first-apply plan;
  // `migrate` (no authored packages) finds no path between unrelated hashes.
  let migrationsDir: string;

  beforeAll(() => {
    migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-app-pn-mig-'));
  });
  afterAll(() => {
    pg.stop();
    if (migrationsDir !== undefined) fs.rmSync(migrationsDir, { recursive: true, force: true });
  });

  test('empty DB → init: applies the contract and signs the target marker', async () => {
    expect(await readMarkerHash(url)).toBeNull();

    const outcome = await applyPnMigration({
      url,
      contractJson: widgetContractJson,
      migrationsDir,
    });

    expect(outcome.action).toBe('init');
    expect(outcome.markerHashBefore).toBeNull();
    expect(outcome.targetHash).toBe(widgetHash);
    // The DB is now signed at the target hash.
    expect(await readMarkerHash(url)).toBe(widgetHash);
  });

  test('re-run at the same hash → noop (idempotent redeploy)', async () => {
    const outcome = await applyPnMigration({
      url,
      contractJson: widgetContractJson,
      migrationsDir,
    });

    expect(outcome.action).toBe('noop');
    expect(outcome.markerHashBefore).toBe(widgetHash);
    expect(outcome.targetHash).toBe(widgetHash);
    expect(await readMarkerHash(url)).toBe(widgetHash);
  });

  test('marker at a different hash with no authored path → fails, DB unchanged', async () => {
    // The DB is currently signed at widgetHash. Target a DIFFERENT contract
    // (gadget) with no authored migration between the two — migrate must fail
    // with MIGRATION_PATH_NOT_FOUND and leave the marker at widgetHash.
    expect(await readMarkerHash(url)).toBe(widgetHash);
    expect(gadgetHash).not.toBe(widgetHash);

    let thrown: unknown;
    try {
      await applyPnMigration({ url, contractJson: gadgetContractJson, migrationsDir });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeInstanceOf(PnMigrationError);
    expect((thrown as PnMigrationError).code).toBe('MIGRATION_PATH_NOT_FOUND');
    // Failed apply left the marker (and schema) unchanged.
    expect(await readMarkerHash(url)).toBe(widgetHash);
  });
});
