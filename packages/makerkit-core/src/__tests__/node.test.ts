import { describe, expect, test } from 'bun:test';
import { connectionEnd, hex, isNode, resource, service } from '../node.ts';
import { conn } from './helpers.ts';

describe('resource()', () => {
  test('returns a branded, frozen resource node carrying its connection', () => {
    const node = resource({
      type: 'fake/db',
      connection: conn({ url: { type: 'string', secret: true } }, (v) => ({ url: v.url })),
    });

    expect(isNode(node)).toBe(true);
    expect(node.kind).toBe('resource');
    expect(node.type).toBe('fake/db');
    expect(node.connection.params).toEqual({ url: { type: 'string', secret: true } });
    expect(Object.isFrozen(node)).toBe(true);
    expect(Object.isFrozen(node.connection)).toBe(true);
    expect(Object.isFrozen(node.connection.params)).toBe(true);
    expect(Object.isFrozen(node.connection.params['url'])).toBe(true);
  });

  test("hydrate is the app's factory — called only when invoked", () => {
    let calls = 0;
    const node = resource({
      type: 'fake/db',
      connection: conn({ url: { type: 'string' } }, (v) => {
        calls += 1;
        return { url: v.url };
      }),
    });

    expect(calls).toBe(0);
    expect(node.connection.hydrate({ url: 'postgres://x' })).toEqual({ url: 'postgres://x' });
    expect(calls).toBe(1);
  });

  test('throws on an empty type', () => {
    expect(() => resource({ type: '', connection: conn({}, () => ({})) })).toThrow(
      /non-empty node type/,
    );
  });
});

describe('service()', () => {
  const build = { kind: 'node', entry: 'dist/server.js' };

  test('returns a branded, frozen service node with frozen inputs, params, and build', () => {
    const db = resource({ type: 'fake/db', connection: conn({}, () => ({})) });
    const node = service({
      type: 'fake/app',
      inputs: { db },
      params: { port: { type: 'number', default: 3000 } },
      build,
    });

    expect(isNode(node)).toBe(true);
    expect(node.kind).toBe('service');
    expect(node.type).toBe('fake/app');
    expect(node.inputs.db).toBe(db);
    expect(node.params).toEqual({ port: { type: 'number', default: 3000 } });
    expect(node.build).toEqual({ kind: 'node', entry: 'dist/server.js' });
    expect(Object.isFrozen(node)).toBe(true);
    expect(Object.isFrozen(node.inputs)).toBe(true);
    expect(Object.isFrozen(node.params)).toBe(true);
    expect(Object.isFrozen(node.params.port)).toBe(true);
    expect(Object.isFrozen(node.build)).toBe(true);
  });

  test('carries no handler — the node is a pure description', () => {
    const node = service({
      type: 'fake/app',
      inputs: { db: resource({ type: 'fake/db', connection: conn({}, () => ({})) }) },
      params: { port: { type: 'number', default: 3000 } },
      build,
    });

    expect('invoke' in node).toBe(false);
    expect(node.build.kind).toBe('node');
  });

  test('throws on an empty type', () => {
    expect(() => service({ type: '', inputs: {}, params: {}, build })).toThrow(
      /non-empty node type/,
    );
  });
});

describe('connectionEnd()', () => {
  test('returns a branded, frozen connection end carrying its connection', () => {
    const end = connectionEnd({
      type: 'fake/http',
      connection: conn({ url: { type: 'string' } }, (v) => ({ url: v.url })),
    });

    expect(isNode(end)).toBe(true);
    expect(end.kind).toBe('connection');
    expect(end.type).toBe('fake/http');
    expect(end.connection.params).toEqual({ url: { type: 'string' } });
    expect(Object.isFrozen(end)).toBe(true);
    expect(Object.isFrozen(end.connection)).toBe(true);
    expect(Object.isFrozen(end.connection.params)).toBe(true);
  });

  test('hydrate is the supplied factory — called only when invoked', () => {
    let calls = 0;
    const end = connectionEnd({
      type: 'fake/http',
      connection: conn({ url: { type: 'string' } }, (v) => {
        calls += 1;
        return { url: v.url };
      }),
    });

    expect(calls).toBe(0);
    expect(end.connection.hydrate({ url: 'https://x' })).toEqual({ url: 'https://x' });
    expect(calls).toBe(1);
  });

  test('throws on an empty type', () => {
    expect(() => connectionEnd({ type: '', connection: conn({}, () => ({})) })).toThrow(
      /non-empty node type/,
    );
  });
});

describe('hex()', () => {
  test('construction is INERT — the body runs only at Load', () => {
    let bodyCalls = 0;
    const node = hex('shop', () => {
      bodyCalls += 1;
    });

    expect(bodyCalls).toBe(0);
    expect(isNode(node)).toBe(true);
    expect(node.kind).toBe('hex');
    expect(node.name).toBe('shop');
    expect(Object.isFrozen(node)).toBe(true);
  });

  test('throws on an empty name', () => {
    expect(() => hex('', () => {})).toThrow(/non-empty name/);
  });
});
