/**
 * serveSchedule(service, schedule, handlers) is serve() specialized to the
 * cron trigger contract: the single exposed `trigger` method dispatches
 * internally on `jobId` to the schedule's handler map, which `handlers` must
 * cover exactly. The native trigger router remains exhaustive over the RPC
 * contract; this additional map is sourced from the schedule's job ids.
 */
import type { Deps, HydratedDeps, Params, RunnableServiceNode } from '@internal/core';
import { blindCast } from '@internal/foundation/casts';
import { implement, serve } from '@internal/rpc';
import { type TriggerContract, triggerContract } from './contract.ts';
import type { Schedule } from './schedule.ts';

type ScheduleHandler<D> = (deps: D) => Promise<unknown>;

export function serveSchedule<D extends Deps, P extends Params, Ids extends string>(
  service: RunnableServiceNode<D, P, { trigger: TriggerContract }>,
  _schedule: Schedule<Ids>,
  handlers: { [Id in Ids]: ScheduleHandler<HydratedDeps<D>> },
): (req: Request) => Promise<Response> {
  const byId = blindCast<
    Record<string, ScheduleHandler<unknown>>,
    "handlers is the exhaustive typed map keyed by the schedule's Ids; dispatch indexes it by the runtime jobId string"
  >(handlers);
  const deps = service.load();

  const rpc = implement(triggerContract.router);
  const router = rpc.router({
    trigger: rpc.trigger.handler(async ({ input }) => {
      const handler = byId[input.jobId];
      if (handler === undefined) {
        throw new Error(
          `serveSchedule(): no handler for job id "${input.jobId}" — not in the schedule.`,
        );
      }
      await handler(deps);
      return { ok: true };
    }),
  });

  return serve(service, { trigger: router });
}
