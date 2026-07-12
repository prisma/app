/**
 * The worker's public RPC contract — the two jobs the router's schedule
 * dispatches to. Lives with the service that owns it (mirrors auth's
 * contract.ts); the router imports it to depend on the worker via
 * `rpc(workerContract)`.
 */
import { contract, rpc } from '@prisma/app-rpc';
import type { StandardSchemaV1 } from '@standard-schema/spec';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const emptyInputSchema: StandardSchemaV1<Record<string, never>> = {
  '~standard': {
    version: 1,
    vendor: '@prisma/example-cron',
    validate: (value: unknown) =>
      isRecord(value) ? { value: {} } : { issues: [{ message: 'expected an object' }] },
  },
};

const okSchema: StandardSchemaV1<{ ok: boolean }> = {
  '~standard': {
    version: 1,
    vendor: '@prisma/example-cron',
    validate: (value: unknown) =>
      isRecord(value) && typeof value['ok'] === 'boolean'
        ? { value: { ok: value['ok'] } }
        : { issues: [{ message: 'expected { ok: boolean }' }] },
  },
};

export const workerContract = contract({
  tick: rpc({ input: emptyInputSchema, output: okSchema }),
  refreshMrr: rpc({ input: emptyInputSchema, output: okSchema }),
});
