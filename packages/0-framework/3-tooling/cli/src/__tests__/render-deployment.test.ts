import { describe, expect, test } from 'bun:test';
import { service } from '@internal/core';
import type { DeploymentResult } from '@internal/core/deploy';
import { deploymentReport, renderDeployment } from '../render-deployment.ts';

/**
 * The renderer reads only `address` and `primitives` — `node` is along for the
 * ride (it is what makes a result joinable to the graph). A real ServiceNode
 * rather than a stub, so these fixtures cannot drift from the type.
 */
const result = (address: string, primitives: DeploymentResult['primitives']): DeploymentResult => ({
  address,
  node: service({
    name: address,
    extension: 'test/pack',
    type: 'compute',
    inputs: {},
    params: {},
    build: {
      extension: '@prisma/composer/node',
      type: 'node',
      module: 'file:///test/service.ts',
      entry: 'server.js',
    },
  }),
  primitives,
});

describe('renderDeployment', () => {
  test('renders the pinned tree: nested addresses, aligned primitives, urls on their own line', () => {
    const results = [
      result('auth.api', [
        { kind: 'compute-service', id: 'cps_abc123', url: 'https://xyz.ewr.prisma.build' },
      ]),
      result('db', [{ kind: 'postgres-database', id: 'pdb_def456' }]),
      result('web', [
        { kind: 'compute-service', id: 'cps_ghi789', url: 'https://uvw.ewr.prisma.build' },
      ]),
    ];

    expect(renderDeployment('storefront-auth', results)).toBe(
      [
        'storefront-auth',
        '├─ auth',
        '│  └─ api   compute-service cps_abc123',
        '│           https://xyz.ewr.prisma.build',
        '├─ db       postgres-database pdb_def456',
        '└─ web      compute-service cps_ghi789',
        '            https://uvw.ewr.prisma.build',
      ].join('\n'),
    );
  });

  test('a node that reported no primitives is listed, not silently dropped — it deployed, it just published nothing', () => {
    const results = [
      result('creds', []),
      result('store', [{ kind: 'compute-service', id: 'cps_1' }]),
    ];

    expect(renderDeployment('app', results)).toBe(
      ['app', '├─ creds   (no primitives reported)', '└─ store   compute-service cps_1'].join('\n'),
    );
  });

  test('an intermediate address segment is structure, not a deployed node — it carries no primitive column', () => {
    // Only `auth.api` deployed; `auth` exists solely to hold it.
    const results = [result('auth.api', [{ kind: 'compute-service', id: 'cps_1' }])];

    expect(renderDeployment('app', results)).toBe(
      ['app', '└─ auth', '   └─ api   compute-service cps_1'].join('\n'),
    );
  });

  test('a node with several primitives puts each on its own line, aligned under the first', () => {
    const results = [
      result('svc', [
        { kind: 'compute-service', id: 'cps_1', url: 'https://a.example' },
        { kind: 'postgres-database', id: 'pdb_1' },
      ]),
    ];

    expect(renderDeployment('app', results)).toBe(
      [
        'app',
        '└─ svc   compute-service cps_1',
        '         https://a.example',
        '         postgres-database pdb_1',
      ].join('\n'),
    );
  });

  test('the app name alone when nothing deployed', () => {
    expect(renderDeployment('app', [])).toBe('app');
  });

  test('deep nesting keeps every primitive in one column', () => {
    const results = [
      result('a.b.c', [{ kind: 'compute-service', id: 'cps_1' }]),
      result('z', [{ kind: 'postgres-database', id: 'pdb_1' }]),
    ];

    expect(renderDeployment('app', results)).toBe(
      [
        'app',
        '├─ a',
        '│  └─ b',
        '│     └─ c   compute-service cps_1',
        '└─ z         postgres-database pdb_1',
      ].join('\n'),
    );
  });
});

describe('deploymentReport', () => {
  test('prints a leading blank line then the rendered tree', () => {
    const lines: unknown[] = [];
    const original = console.log;
    console.log = (value?: unknown) => {
      lines.push(value);
    };
    try {
      deploymentReport('app')([result('db', [{ kind: 'postgres-database', id: 'pdb_1' }])]);
    } finally {
      console.log = original;
    }

    expect(lines).toEqual(['', 'app\n└─ db   postgres-database pdb_1']);
  });
});
