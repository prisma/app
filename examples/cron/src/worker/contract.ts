/**
 * The worker's public RPC contract — the two jobs the runner's schedule
 * dispatches to. Lives with the service that owns it (mirrors auth's
 * contract.ts); the runner imports it to depend on the worker via
 * `rpc(workerContract)`.
 */
import { contract, oc } from '@prisma/composer/rpc';
import { type } from 'arktype';

export const workerContract = contract({
  tick: oc.input(type({})).output(type({ ok: 'boolean' })),
  refreshMrr: oc.input(type({})).output(type({ ok: 'boolean' })),
});
