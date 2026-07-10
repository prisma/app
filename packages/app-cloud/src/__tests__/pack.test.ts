import { describe, expect, test } from 'bun:test';
import type { Contract } from '@prisma/app';
import { configOf, hydrateSync, isNode } from '@prisma/app';
import { compute, postgres, postgresContract } from '../index.ts';
import { configKey, deserialize } from '../serializer.ts';

const build = {
  kind: 'node',
  pack: '@prisma/app-node',
  module: 'file:///test/service.ts',
  entry: 'server.js',
};

/** Sets env vars for the duration of `fn`, restoring whatever was there before. */
async function withEnv<T>(values: Record<string, string>, fn: () => Promise<T> | T): Promise<T> {
  const previous = new Map(Object.keys(values).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const [k, v] of previous) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('postgres({ name })', () => {
  test('returns a branded resource identity providing postgresContract; type is the contract kind', () => {
    const node = postgres({ name: 'db' });

    expect(isNode(node)).toBe(true);
    expect(node.kind).toBe('resource');
    expect(node.type).toBe('postgres');
    expect(node.pack).toBe('@prisma/app-cloud');
    expect(node.name).toBe('db');
    expect(node.provides).toBe(postgresContract);
    expect('connection' in node).toBe(false);
  });
});

describe('postgres({ client })', () => {
  test('returns a branded dependency end requiring postgresContract, declaring { url: string, secret }', () => {
    const end = postgres({
      client: ({ url }) => ({ url }),
    });

    expect(isNode(end)).toBe(true);
    expect(end.kind).toBe('dependency');
    expect(end.type).toBe('postgres');
    expect(end.name).toBe('postgres');
    expect(end.required).toBe(postgresContract);
    expect(end.connection.params).toEqual({ url: { type: 'string', secret: true } });
  });

  test("hydrate delegates to the app's client factory; C is inferred", async () => {
    const made: unknown[] = [];
    const end = postgres({
      client: (config) => {
        made.push(config);
        return { fake: 'client', ...config };
      },
    });

    const client = await end.connection.hydrate({ url: 'postgres://u:p@host:5432/db' });

    expect(made).toEqual([{ url: 'postgres://u:p@host:5432/db' }]);
    expect(client).toEqual({ fake: 'client', url: 'postgres://u:p@host:5432/db' });
  });
});

describe('postgres() argument-shape exclusivity', () => {
  test('an empty argument throws naming the accepted shapes', () => {
    expect(() => postgres({} as never)).toThrow(/requires `name`.+`client`/);
  });

  test('both name and client throws — the identity and the dependency are separate', () => {
    expect(() =>
      postgres({ name: 'db', client: ({ url }: { url: string }) => ({ url }) } as never),
    ).toThrow(/takes `name`.+OR `client`.+not both/);
  });
});

describe('compute()', () => {
  test('returns a branded, runnable service node declaring { port: number, default 3000 }', () => {
    const node = compute({
      name: 'test-service',
      deps: {},
      build,
    });

    expect(isNode(node)).toBe(true);
    expect(node.kind).toBe('service');
    expect(node.type).toBe('compute');
    expect(node.params).toEqual({ port: { type: 'number', default: 3000 } });
    expect(typeof node.run).toBe('function');
    expect(typeof node.load).toBe('function');
  });

  test('is inert until run or load — the client factory does not run at construction', () => {
    let calls = 0;
    const db = postgres({
      client: ({ url }) => {
        calls += 1;
        return { url };
      },
    });
    const node = compute({
      name: 'test-service',
      deps: { db },
      build,
    });

    expect(node.inputs.db).toBe(db);
    expect(calls).toBe(0);
  });

  test('DI without any environment: hydrateSync against a hand-built Config runs the real connection factories', () => {
    const node = compute({
      name: 'test-service',
      deps: {
        db: postgres({
          client: ({ url }) => ({ url }),
        }),
      },
      build,
    });

    const deps = hydrateSync(node, {
      service: { port: 0 },
      inputs: { db: { url: 'postgres://fake' } },
    });

    expect(deps).toEqual({ db: { url: 'postgres://fake' } });
  });
});

describe('compute({ expose })', () => {
  const fakeContract = <Cmp>(cmp: Cmp): Contract<'rpc', Cmp> => ({
    kind: 'rpc',
    __cmp: cmp,
    satisfies: (required) => required.__cmp === cmp,
  });

  test('threads the exposed contract map onto the node, frozen', () => {
    const authContract = fakeContract({ verify: async () => ({ ok: true }) });

    const node = compute({
      name: 'test-service',
      deps: {},
      build,
      expose: { rpc: authContract },
    });

    expect(node.expose).toEqual({ rpc: authContract });
    expect(node.expose?.rpc).toBe(authContract);
    expect(Object.isFrozen(node.expose)).toBe(true);
  });

  test('expose is absent when not declared — services without it keep working unchanged', () => {
    const node = compute({
      name: 'test-service',
      deps: {},
      build,
    });

    expect(node.expose).toBeUndefined();
  });
});

describe("the config serializer (shared by run() and /target's serialize)", () => {
  test("configKey: lone-service root (address '') is unprefixed — owner ▸ name", () => {
    const app = compute({
      name: 'test-service',
      deps: {
        db: postgres({
          client: ({ url }) => ({ url }),
        }),
      },
      build,
    });
    const [dbUrl, port] = configOf(app);
    if (dbUrl === undefined || port === undefined) throw new Error('expected config declarations');

    expect(configKey('', dbUrl)).toBe('DB_URL');
    expect(configKey('', port)).toBe('PORT');
  });

  test('configKey: a system-addressed service prefixes with its address segment', () => {
    const app = compute({
      name: 'test-service',
      deps: {
        db: postgres({
          client: ({ url }) => ({ url }),
        }),
      },
      build,
    });
    const [dbUrl] = configOf(app);
    if (dbUrl === undefined) throw new Error('expected a config declaration');

    expect(configKey('auth', dbUrl)).toBe('AUTH_DB_URL');
  });

  test('configKey: a connection-end input keys the same way as a resource input', () => {
    const app = compute({
      name: 'test-service',
      deps: {},
      build,
    });
    // A synthetic declaration shaped like configOf would produce for a
    // connection-end input named "auth".
    const decl = {
      owner: { input: 'auth' },
      name: 'url',
      type: 'string' as const,
      secret: false,
      optional: false,
      default: undefined,
    };

    expect(configKey('storefront', decl)).toBe('STOREFRONT_AUTH_URL');
    void app;
  });

  test('deserialize round-trips what a service declares, reading process.env by configKey', async () => {
    const app = compute({
      name: 'test-service',
      deps: {
        db: postgres({
          client: ({ url }) => ({ url }),
        }),
      },
      build,
    });
    const shape = configOf(app);

    await withEnv({ DB_URL: 'postgres://x', PORT: '4001' }, () => {
      const config = deserialize(shape, '');
      expect(config).toEqual({ service: { port: 4001 }, inputs: { db: { url: 'postgres://x' } } });
    });
  });

  test('deserialize: an unset param with a default resolves to the default', async () => {
    const app = compute({
      name: 'test-service',
      deps: {},
      build,
    });
    const shape = configOf(app);

    await withEnv({}, () => {
      expect(deserialize(shape, '')).toEqual({ service: { port: 3000 }, inputs: {} });
    });
  });

  test('deserialize: a missing required param fails loudly, naming the param', async () => {
    const app = compute({
      name: 'test-service',
      deps: {
        db: postgres({
          client: ({ url }) => ({ url }),
        }),
      },
      build,
    });
    const shape = configOf(app);

    await withEnv({}, () => {
      expect(() => deserialize(shape, '')).toThrow(/db\.url|"url"/);
    });
  });

  test('deserialize: an invalid number fails loudly even with a default present', async () => {
    const app = compute({
      name: 'test-service',
      deps: {},
      build,
    });
    const shape = configOf(app);

    await withEnv({ PORT: 'not-a-number' }, () => {
      expect(() => deserialize(shape, '')).toThrow(/port/);
    });
  });

  test('round-trip: a numeric leaf serializes to a string and deserializes back to the identical number', async () => {
    // The gap that hid the serialize bug: /target's serialize encodes typed→
    // string (3000 → "3000"), and this same module's deserialize must read it
    // back as a number (3000). Emulate serialize's encoding for the `port`
    // param, keyed by the SHARED configKey, then read it back through
    // deserialize and assert the number is identical.
    const app = compute({
      name: 'test-service',
      deps: {},
      build,
    });
    const shape = configOf(app);
    const portDecl = shape.find((d) => d.name === 'port');
    if (portDecl === undefined) throw new Error('expected a port declaration');

    const original = 3000;
    // serialize (in target.ts): a concrete number stringifies.
    const encoded = typeof original === 'number' ? String(original) : original;
    expect(encoded).toBe('3000');

    await withEnv({ [configKey('auth', portDecl)]: encoded }, () => {
      const config = deserialize(shape, 'auth');
      expect(config.service['port']).toBe(original);
      expect(typeof config.service['port']).toBe('number');
    });
  });
});

describe('compute().run(address, boot) → load() — the round trip', () => {
  test('deploy-side serialize writes address-keyed env; run() re-keys it address-free; load() hydrates it', async () => {
    const app = compute({
      name: 'test-service',
      deps: {
        db: postgres({
          client: ({ url }) => ({ url }),
        }),
      },
      build,
    });

    let loaded: unknown;
    await withEnv({ AUTH_DB_URL: 'postgres://x', AUTH_PORT: '4001', DB_URL: '', PORT: '' }, () =>
      app.run('auth', async () => {
        loaded = app.load();
      }),
    );

    expect(loaded).toEqual({ db: { url: 'postgres://x' }, port: 4001 });
  });

  test("a lone-service deploy (address '') reads and re-stashes the same unprefixed keys", async () => {
    const app = compute({
      name: 'test-service',
      deps: {
        db: postgres({
          client: ({ url }) => ({ url }),
        }),
      },
      build,
    });

    let loaded: unknown;
    await withEnv({ DB_URL: 'postgres://y', PORT: '' }, () =>
      app.run('', async () => {
        loaded = app.load();
      }),
    );

    expect(loaded).toEqual({ db: { url: 'postgres://y' }, port: 3000 });
  });

  test('a client dependency in deps round-trips through run()/load() — typed hydration', async () => {
    const db = postgres({ client: ({ url }) => ({ url }) });
    const app = compute({ name: 'test-service', deps: { db }, build });

    let loaded: unknown;
    await withEnv({ DB_URL: 'postgres://dual', PORT: '' }, () =>
      app.run('', async () => {
        loaded = app.load();
      }),
    );

    expect(loaded).toEqual({ db: { url: 'postgres://dual' }, port: 3000 });
  });

  test('run() calls boot() exactly once, even with nothing to hydrate', async () => {
    let bootCalls = 0;
    const app = compute({
      name: 'test-service',
      deps: {},
      build,
    });

    await app.run('', async () => {
      bootCalls += 1;
    });

    expect(bootCalls).toBe(1);
  });
});

describe('compute().load()', () => {
  test('returns hydrated deps merged with resolved params, memoized per process (hydrate runs once)', async () => {
    let hydrateCalls = 0;
    const app = compute({
      name: 'test-service',
      deps: {
        db: postgres({
          client: ({ url }) => {
            hydrateCalls += 1;
            return { url };
          },
        }),
      },
      build,
    });

    await withEnv({ DB_URL: 'postgres://z', PORT: '' }, () => {
      const first = app.load();
      const second = app.load();

      expect(first).toBe(second);
      expect(first).toEqual({ db: { url: 'postgres://z' }, port: 3000 });
    });

    expect(hydrateCalls).toBe(1);
  });
});

describe('the config pipeline over pack nodes', () => {
  test('configOf is semantic — owner/name/type/secret, no platform keys', () => {
    const app = compute({
      name: 'test-service',
      deps: {
        db: postgres({
          client: ({ url }) => ({ url }),
        }),
      },
      build,
    });

    expect(configOf(app)).toEqual([
      {
        owner: { input: 'db' },
        name: 'url',
        type: 'string',
        secret: true,
        optional: false,
        default: undefined,
      },
      {
        owner: 'service',
        name: 'port',
        type: 'number',
        secret: false,
        optional: false,
        default: 3000,
      },
    ]);
    expect(JSON.stringify(configOf(app))).not.toContain('DATABASE_URL');
  });

  test('a dep-less service declares only its own params', () => {
    const app = compute({
      name: 'test-service',
      deps: {},
      build,
    });

    expect(configOf(app)).toEqual([
      {
        owner: 'service',
        name: 'port',
        type: 'number',
        secret: false,
        optional: false,
        default: 3000,
      },
    ]);
  });
});

describe('importing a service module', () => {
  test('runs nothing (invariant 3): the client factory only runs when load() hydrates it', async () => {
    const fixture = await import('./fixtures/side-effect-service.ts');

    expect(fixture.clientCalls).toBe(0);

    await withEnv({ DB_URL: 'postgres://fixture', PORT: '' }, () => {
      fixture.default.load();
    });

    expect(fixture.clientCalls).toBe(1);
  });
});
