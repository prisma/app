/**
 * serveSchedule(service, schedule, handlers) forces an exhaustive handler map
 * keyed by the schedule's own job ids — a missing job id, or a handler for a
 * job id outside the schedule, must not compile.
 *
 * Type-only (vitest `--typecheck`, never executed) — mirrors
 * `@prisma/app-rpc`'s `serve-handlers.test-d.ts`.
 */
import type { DependencyEnd, RunnableServiceNode } from '@prisma/app';
import { dependency, service } from '@prisma/app';
import { test } from 'vitest';
import { triggerContract } from '../contract.ts';
import { defineSchedule } from '../schedule.ts';
import { serveSchedule } from '../serve-schedule.ts';

interface FakeDeps {
  readonly calls: string[];
}

const target: DependencyEnd<FakeDeps> = dependency({
  name: 'target',
  type: 'fake/target',
  connection: { params: {}, hydrate: () => ({ calls: [] }) },
});
const node = service({
  name: 'router',
  extension: 'test/pack',
  type: 'fake/router-test',
  inputs: { target },
  params: {},
  build: {
    extension: '@fake/adapter',
    type: 'fake',
    module: 'file:///test/service.ts',
    entry: 'x',
  },
  expose: { trigger: triggerContract },
});

declare const routerService: RunnableServiceNode<
  typeof node.inputs,
  typeof node.params,
  { trigger: typeof triggerContract }
>;

const schedule = defineSchedule({ tick: '2s', mrr: '5s' });

test('a complete handler map for every schedule job id compiles', () => {
  serveSchedule(routerService, schedule, {
    tick: async (deps) => {
      deps.target.calls.length;
    },
    mrr: async (deps) => {
      deps.target.calls.length;
    },
  });
});

test('a missing handler for a scheduled job id does not compile', () => {
  // @ts-expect-error missing the required "mrr" handler
  serveSchedule(routerService, schedule, {
    tick: async () => undefined,
  });
});

test('a handler for a job id outside the schedule does not compile', () => {
  serveSchedule(routerService, schedule, {
    tick: async () => undefined,
    mrr: async () => undefined,
    // @ts-expect-error "nope" is not a scheduled job id
    nope: async () => undefined,
  });
});

test('a handler that is not a function does not compile', () => {
  serveSchedule(routerService, schedule, {
    // @ts-expect-error "tick" must be a function, not a string
    tick: 'not-a-function',
    mrr: async () => undefined,
  });
});
