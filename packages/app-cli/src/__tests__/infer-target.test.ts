import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AssembleError } from '@prisma/app-assemble';
import type { Graph } from '@prisma/app';
import { resource, service } from '@prisma/app';
import { collectPacks, extractFromEnv, inferTarget, resolveSinglePack } from '../infer-target.ts';

const build = {
  kind: 'node',
  pack: '@prisma/app-node',
  module: 'file:///test/service.ts',
  entry: 'server.js',
} as const;

function graphWithPacks(packs: readonly string[]): Graph {
  const nodes = packs.map((pack, i) => ({
    id: `svc-${i}`,
    node: service({
      name: `svc-${i}`,
      pack,
      type: 'fixture/service',
      inputs: {},
      params: {},
      build,
    }),
  }));
  const root = nodes[0];
  if (root === undefined) throw new Error('graphWithPacks needs at least one pack');
  return { root, nodes, edges: [] };
}

describe('collectPacks() + resolveSinglePack() (ADR-0003)', () => {
  test('collects the distinct pack across service and resource nodes', () => {
    const graph = graphWithPacks(['@prisma/app-cloud', '@prisma/app-cloud']);
    expect(collectPacks(graph)).toEqual(['@prisma/app-cloud']);
    expect(resolveSinglePack(collectPacks(graph))).toBe('@prisma/app-cloud');
  });

  test('includes resource-node packs too', () => {
    const svc = service({
      name: 'svc',
      pack: '@prisma/app-cloud',
      type: 'fixture/service',
      inputs: {},
      params: {},
      build,
    });
    const res = resource({
      name: 'res',
      pack: '@other/pack',
      provides: {
        kind: 'fixture/resource',
        __cmp: {},
        satisfies: () => true,
      },
    });
    const graph: Graph = {
      root: { id: 'root', node: svc },
      nodes: [
        { id: 'root', node: svc },
        { id: 'root.db', node: res },
      ],
      edges: [],
    };
    expect(collectPacks(graph)).toEqual(['@other/pack', '@prisma/app-cloud']);
  });

  test('throws listing every pack found when a graph mixes more than one', () => {
    const graph = graphWithPacks(['@prisma/app-cloud', '@other/pack']);
    expect(() => resolveSinglePack(collectPacks(graph))).toThrow(
      /mixes more than one pack \(@other\/pack, @prisma\/app-cloud\)/,
    );
  });

  test('throws when the graph carries no pack at all', () => {
    expect(() => resolveSinglePack([])).toThrow(/carries no pack/);
  });
});

describe("extractFromEnv() — the pack's /target module must export fromEnv()", () => {
  test('returns the export when present', () => {
    const fakeTarget = { name: 'fake-target' };
    const fromEnv = extractFromEnv('@fake/pack', '@fake/pack/target', {
      fromEnv: () => fakeTarget,
    });
    expect(fromEnv()).toBe(fakeTarget);
  });

  test('throws naming the pack and the expected export when fromEnv is missing', () => {
    expect(() => extractFromEnv('@fake/pack', '@fake/pack/target', {})).toThrow(
      /Pack "@fake\/pack" has no fromEnv\(\) export at "@fake\/pack\/target"/,
    );
  });

  test('throws the same way when the module has no exports at all', () => {
    expect(() => extractFromEnv('@fake/pack', '@fake/pack/target', null)).toThrow(
      /has no fromEnv\(\) export/,
    );
  });
});

describe('inferTarget() — an unresolvable pack (F03, verifying the S5 entry-anchored rewrite closed it)', () => {
  test('a pack that is not installed surfaces an AssembleError naming the pack and the fix, not a raw module error', async () => {
    const dir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'makerkit-cli-infer-target-')),
    );
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-app' }));
      const entryPath = path.join(dir, 'service.ts');
      const graph = graphWithPacks(['@prisma/does-not-exist']);

      await expect(inferTarget(graph, entryPath)).rejects.toThrow(AssembleError);
      await expect(inferTarget(graph, entryPath)).rejects.toThrow(
        /Cannot resolve "@prisma\/does-not-exist\/target".*must depend on "@prisma\/does-not-exist"/s,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
