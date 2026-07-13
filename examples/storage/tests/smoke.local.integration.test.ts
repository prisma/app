/**
 * Proves the aws-sdk smoke suite locally BEFORE the cloud run: boots the same
 * storage service the module deploys (the /storage/testing local stand-in over
 * a throwaway local Postgres) and runs the full op suite against it. The suite
 * that passes here is the exact one the deployed smoke service runs.
 *
 * Skipped only on a dev machine with no Postgres; on CI the harness throws.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createPgStore, startStorageServer } from '@prisma/compose-prisma-cloud/storage/testing';
import { runSmoke } from '../src/smoke/ops.ts';
import { startTestPostgres, type TestPostgres } from './pg-harness.ts';

const CREDENTIALS = { accessKeyId: 'AKIALOCALSMOKE', secretAccessKey: 'local-smoke-secret' };
const BUCKET = 'storage';

const pg = startTestPostgres();
const suite = pg ? describe : describe.skip;

suite('storage example smoke suite (local stand-in)', () => {
  let postgres: TestPostgres;
  let server: ReturnType<typeof startStorageServer>;

  beforeAll(async () => {
    if (!pg) throw new Error('no Postgres available');
    postgres = pg;
    const store = await createPgStore(postgres.url);
    server = startStorageServer({ store, credentials: CREDENTIALS, bucket: BUCKET, port: 0 });
  });

  afterAll(() => {
    server?.stop();
    postgres?.stop();
  });

  test('every in-scope op passes against the local store', async () => {
    const result = await runSmoke({
      url: server.url,
      bucket: BUCKET,
      accessKeyId: CREDENTIALS.accessKeyId,
      secretAccessKey: CREDENTIALS.secretAccessKey,
    });
    const failed = result.results.filter((r) => !r.ok);
    expect(failed).toEqual([]);
    expect(result.ok).toBe(true);
    // Every op the deployed smoke reports on is exercised here.
    expect(result.results.map((r) => r.op)).toEqual([
      'put-get-roundtrip',
      'ranged-get-closed',
      'ranged-get-open-ended',
      'head',
      'delete-idempotent',
      'list-pagination',
      'missing-get-404',
      'missing-head-404',
      'presigned-put-get',
    ]);
  });
});
