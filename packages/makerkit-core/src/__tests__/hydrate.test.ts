import { describe, expect, test } from 'bun:test';
import { hydrate, hydrateSync } from '../hydrate.ts';
import { connectionEnd, resource, service } from '../node.ts';
import { conn } from './helpers.ts';

const build = { kind: 'node', entry: 'server.js' };

const dbNode = (record?: (values: { url: string }) => void) =>
  resource({
    type: 'fake/db',
    connection: conn({ url: { type: 'string', secret: true } }, (v) => {
      record?.(v);
      return { client: v.url };
    }),
  });

const portParams = { port: { type: 'number', default: 3000 } } as const;

describe('hydrate', () => {
  test("calls each input's connection.hydrate with its typed Config slice", async () => {
    const made: unknown[] = [];
    const root = service({
      type: 'fake/app',
      inputs: { db: dbNode((v) => made.push(v)) },
      params: portParams,
      build,
    });

    const deps = await hydrate(root, {
      service: { port: 8080 },
      inputs: { db: { url: 'postgres://x' } },
    });

    expect(made).toEqual([{ url: 'postgres://x' }]);
    expect(deps).toEqual({ db: { client: 'postgres://x' } });
  });

  test('a ConnectionEnd hydrates through identical machinery — the app cannot tell it apart', async () => {
    const root = service({
      type: 'fake/app',
      inputs: {
        auth: connectionEnd({
          type: 'fake/http',
          connection: conn({ url: { type: 'string' } }, (v) => ({ fetchBase: v.url })),
        }),
      },
      params: {},
      build,
    });

    const deps = await hydrate(root, {
      service: {},
      inputs: { auth: { url: 'https://auth.example' } },
    });

    expect(deps).toEqual({ auth: { fetchBase: 'https://auth.example' } });
  });

  test('async hydrate is awaited', async () => {
    const root = service({
      type: 'fake/app',
      inputs: {
        db: resource({
          type: 'fake/db',
          connection: conn({ url: { type: 'string' } }, async (v) => {
            await Promise.resolve();
            return { asyncClient: v.url };
          }),
        }),
      },
      params: {},
      build,
    });

    const deps = await hydrate(root, { service: {}, inputs: { db: { url: 'postgres://x' } } });

    expect(deps).toEqual({ db: { asyncClient: 'postgres://x' } });
  });

  test('a dep-less service hydrates to an empty deps object', async () => {
    const root = service({ type: 'fake/app', inputs: {}, params: portParams, build });

    expect(await hydrate(root, { service: { port: 3000 }, inputs: {} })).toEqual({});
  });
});

describe('hydrateSync', () => {
  test('hydrates every input synchronously — no await required', () => {
    const made: unknown[] = [];
    const root = service({
      type: 'fake/app',
      inputs: { db: dbNode((v) => made.push(v)) },
      params: portParams,
      build,
    });

    const deps = hydrateSync(root, {
      service: { port: 8080 },
      inputs: { db: { url: 'postgres://x' } },
    });

    expect(made).toEqual([{ url: 'postgres://x' }]);
    expect(deps).toEqual({ db: { client: 'postgres://x' } });
  });

  test('throws, naming the input, when a connection hydrate returns a Promise', () => {
    const root = service({
      type: 'fake/app',
      inputs: {
        db: resource({
          type: 'fake/db',
          connection: conn({ url: { type: 'string' } }, async (v) => ({ asyncClient: v.url })),
        }),
      },
      params: {},
      build,
    });

    expect(() =>
      hydrateSync(root, { service: {}, inputs: { db: { url: 'postgres://x' } } }),
    ).toThrow(/db/);
  });
});
