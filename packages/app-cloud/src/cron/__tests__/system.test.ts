import { describe, expect, test } from 'bun:test';
import { Load, LoadError, system } from '@prisma/app';
import node from '@prisma/app-node';
import { contract, rpc } from '@prisma/app-rpc';
import { type } from 'arktype';
import { compute } from '../../compute.ts';
import { triggerContract } from '../contract.ts';
import { defineSchedule } from '../schedule.ts';
import { cron } from '../system.ts';

const build = node({ module: import.meta.url, entry: '../dist/service.mjs' });

const workerContract = contract({
  work: rpc({ input: type({ jobId: 'string' }), output: type({ ok: 'boolean' }) }),
});

const worker = () =>
  compute({
    name: 'worker',
    deps: {},
    build,
    expose: { work: workerContract },
  });

const runner = () =>
  compute({
    name: 'runner',
    deps: { worker: rpc(workerContract) },
    build,
    expose: { trigger: triggerContract },
  });

const schedule = defineSchedule({ tick: '2s' });

describe('cron()', () => {
  test('Loads a graph with the provisioned runner and scheduler, wired to each other and to the worker', () => {
    const root = system('root', {}, ({ provision }) => {
      const w = provision(worker(), { id: 'worker' });
      provision(cron({ schedule, runner: runner() }), { id: 'cron', deps: { worker: w.work } });
      return {};
    });

    const graph = Load(root);
    const ids = graph.nodes.map((n) => n.id);

    expect(ids).toContain('cron.runner');
    expect(ids).toContain('cron.scheduler');
    expect(graph.edges).toContainEqual({
      from: 'worker',
      to: 'cron.runner',
      input: 'worker',
      kind: 'dependency',
    });
    expect(graph.edges).toContainEqual({
      from: 'cron.runner',
      to: 'cron.scheduler',
      input: 'trigger',
      kind: 'dependency',
    });
  });

  test("an invalid wiring — the runner's own dep left unwired into the cron system — throws at Load", () => {
    const root = system('root', {}, ({ provision }) => {
      provision(worker(), { id: 'worker' });
      // The cron system's boundary dep ("worker", mirroring the runner's own
      // dep) is never wired — bypasses the compile-time check the same way
      // system-composition.test.ts's own error-case tests do, to exercise
      // Load's runtime backstop.
      provision(cron({ schedule, runner: runner() }), { id: 'cron', deps: {} as never });
      return {};
    });

    expect(() => Load(root)).toThrow(LoadError);
    expect(() => Load(root)).toThrow(
      'Dependency input "worker" of provisioned system "cron" is not wired to a producer (system "root").',
    );
  });
});
