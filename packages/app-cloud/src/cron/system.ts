/**
 * The swap boundary (ADR-0020): the app calls `cron()` and never provisions
 * the scheduler itself, so a future native realization is an internal change,
 * not an app change. `cron()` is ordinary composition — no new primitive: it
 * provisions the app's router with the system's own inputs forwarded
 * straight through (the router's deps ARE the system's boundary deps), then
 * provisions the reusable scheduler wired to the router's `trigger` port.
 */
import type { Deps, Params, ServiceNode, SystemNode } from '@prisma/app';
import { system } from '@prisma/app';
import type { TriggerContract } from './contract.ts';
import type { Schedule } from './schedule.ts';
import { cronScheduler } from './scheduler.ts';

/**
 * Wraps `opts.router` (a service exposing `{ trigger }`) with the reusable
 * scheduler that fires `opts.schedule` against it. The returned system's
 * boundary deps mirror the router's own deps — the parent wires the real
 * work target through them, e.g.
 * `provision('cron', cron('cron', { schedule, router }), { worker: worker.rpc })`.
 * Exposes nothing.
 */
export function cron<RD extends Deps, RP extends Params, Ids extends string>(
  name: string,
  opts: {
    schedule: Schedule<Ids>;
    router: ServiceNode<RD, RP, { trigger: TriggerContract }>;
  },
): SystemNode<RD, Record<never, never>> {
  return system(name, { deps: opts.router.inputs }, ({ inputs, provision }) => {
    const router = provision('router', opts.router, inputs);
    provision('scheduler', cronScheduler(opts.schedule), { trigger: router.trigger });
    return {};
  });
}
