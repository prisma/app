import { describe, expect, test } from 'bun:test';
import { Load, LoadError } from '../graph.ts';
import { connectionEnd, resource, service } from '../node.ts';
import { conn } from './helpers.ts';

const build = {
  kind: 'node',
  pack: '@makerkit/node',
  module: 'file:///test/service.ts',
  entry: 'server.js',
};

const db = () =>
  resource({
    name: 'test-resource',
    pack: 'test/pack',
    type: 'fake/db',
    connection: conn({}, () => ({})),
  });
const app = (inputs: Record<string, ReturnType<typeof db>>) =>
  service({
    name: 'test-service',
    pack: 'test/pack',
    type: 'fake/app',
    inputs,
    params: {},
    build,
  });

describe('Load', () => {
  test('builds path-derived ids, edges, and topo-ordered nodes (deps first)', () => {
    const input = db();
    const root = app({ db: input });

    const graph = Load(root, { id: 'hello' });

    expect(graph.root).toEqual({ id: 'hello', node: root });
    expect(graph.nodes.map((n) => n.id)).toEqual(['hello.db', 'hello']);
    expect(graph.edges).toEqual([{ from: 'hello.db', to: 'hello', input: 'db', kind: 'input' }]);
  });

  test('defaults the root id to "root"', () => {
    const graph = Load(app({ db: db() }));

    expect(graph.root.id).toBe('root');
    expect(graph.nodes.map((n) => n.id)).toEqual(['root.db', 'root']);
  });

  test('one graph node per input, root last', () => {
    const graph = Load(app({ a: db(), b: db() }), { id: 'svc' });

    expect(graph.nodes.map((n) => n.id)).toEqual(['svc.a', 'svc.b', 'svc']);
    expect(graph.edges).toEqual([
      { from: 'svc.a', to: 'svc', input: 'a', kind: 'input' },
      { from: 'svc.b', to: 'svc', input: 'b', kind: 'input' },
    ]);
  });

  test('executes nothing — Load never calls a connection hydrate', () => {
    let calls = 0;
    const root = service({
      name: 'test-service',
      pack: 'test/pack',
      type: 'fake/app',
      inputs: {
        db: resource({
          name: 'test-resource',
          pack: 'test/pack',
          type: 'fake/db',
          connection: conn({}, () => {
            calls += 1;
            return {};
          }),
        }),
      },
      params: {},
      build,
    });

    Load(root);

    expect(calls).toBe(0);
  });

  test('rejects a root that is not a branded service node', () => {
    expect(() => Load({} as never)).toThrow(LoadError);
    expect(() => Load(db() as never)).toThrow(LoadError);
  });

  test('rejects an input that is not a branded resource node', () => {
    const root = app({ db: { kind: 'resource', type: 'fake/db' } as never });

    expect(() => Load(root)).toThrow(LoadError);
    expect(() => Load(root)).toThrow(/db/);
  });

  test('rejects a forged input with an empty type', () => {
    // Spread copies the brand symbol but lets the type be emptied — Load must catch it.
    const forged = { ...db(), type: '' };
    const root = app({ db: forged as never });

    expect(() => Load(root)).toThrow(LoadError);
    expect(() => Load(root)).toThrow(/empty node type/);
  });

  test('rejects a root service with an unwired ConnectionEnd input, naming the input and pointing at the composing hex (ADR-0003)', () => {
    const auth = connectionEnd({
      name: 'auth',
      type: 'fake/http',
      connection: conn({ url: { type: 'string' } }, (v) => ({ url: v.url })),
    });
    const root = service({
      name: 'storefront',
      pack: 'test/pack',
      type: 'fake/app',
      inputs: { auth },
      params: {},
      build,
    });

    expect(() => Load(root, { id: 'storefront' })).toThrow(LoadError);
    expect(() => Load(root, { id: 'storefront' })).toThrow(
      /Service "storefront" has an unwired connection input "auth" — this service is composed by a hex; deploy the hex instead of loading "storefront" directly\./,
    );
  });
});
