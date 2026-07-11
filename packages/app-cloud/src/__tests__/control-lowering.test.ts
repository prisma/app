import { describe, expect, mock, test } from 'bun:test';
import type { LowerContext, LoweredNode } from '@prisma/app/deploy';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';

// Stub the provider layer AND alchemy/Output so the compute target's data
// flow (id derivation, props threading, outputs shape) runs purely — no
// Alchemy engine, no cloud. Output.map just applies its function directly
// (real Output values are lazy expressions; here every "output" is already
// the resolved value the mock resource returned).
const recorded = {
  envVar: [] as unknown[][],
  db: [] as unknown[][],
  conn: [] as unknown[][],
  svc: [] as unknown[][],
  deploy: [] as unknown[][],
  pkg: [] as unknown[][],
};

mock.module('alchemy/Output', () => ({
  map: (output: unknown, fn: (v: unknown) => unknown) => fn(output),
}));

mock.module('@prisma/alchemy', () => ({
  providers: () => ({ stub: 'providers' }),
  EnvironmentVariable: (id: string, props: { key: string }) => {
    recorded.envVar.push([id, props]);
    return Effect.succeed({ id: `${id}#cloud-id`, key: props.key });
  },
  Database: (id: string, props: unknown) => {
    recorded.db.push([id, props]);
    return Effect.succeed({ id: `${id}#cloud-id`, name: id });
  },
  Connection: (id: string, props: unknown) => {
    recorded.conn.push([id, props]);
    return Effect.succeed({
      id: `${id}#cloud-id`,
      connectionString: Redacted.make(`postgres://${id}`),
    });
  },
  ComputeService: (id: string, props: unknown) => {
    recorded.svc.push([id, props]);
    return Effect.succeed({ id: `${id}#cloud-id`, name: id });
  },
  Deployment: (id: string, props: unknown) => {
    recorded.deploy.push([id, props]);
    return Effect.succeed({ versionId: 'v1', deployedUrl: `https://${id}.example` });
  },
  packageComputeArtifact: (opts: { id: string }) => {
    recorded.pkg.push([opts]);
    return { path: `/tmp/${opts.id}.tar.gz`, sha256: `sha-${opts.id}` };
  },
}));

const { prismaCloud } = await import('../control.ts');
const { compute, postgres } = await import('../index.ts');
const { system } = await import('@prisma/app');
const { lowering } = await import('@prisma/app/deploy');

const run = <A>(eff: Effect.Effect<A, unknown, unknown>): A =>
  Effect.runSync(eff as Effect.Effect<A>);

/** Sets env vars for the duration of `fn`, restoring whatever was there before. */
async function withEnv<T>(values: Record<string, string | undefined>, fn: () => T): Promise<T> {
  const previous = new Map(Object.keys(values).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of previous) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// Typed accessors over the kind-discriminated registry — a wrong kind here is
// a test bug, so they throw rather than silently widen.
type Descriptor = ReturnType<typeof prismaCloud>;
function applicationOf(descriptor: Descriptor) {
  if (descriptor.application === undefined) throw new Error('expected an application hook');
  return descriptor.application;
}
function resourceControlOf(descriptor: Descriptor, type: string) {
  const control = descriptor.nodes[type];
  if (control === undefined || control.kind !== 'resource')
    throw new Error(`expected a resource control for "${type}"`);
  return control;
}
function serviceControlOf(descriptor: Descriptor, type: string) {
  const control = descriptor.nodes[type];
  if (control === undefined || control.kind !== 'service')
    throw new Error(`expected a service control for "${type}"`);
  return control;
}
const configFor = (descriptor: Descriptor) => ({
  extensions: [descriptor],
  state: () => {
    throw new Error('state() must not be called by lowering()');
  },
});

describe('prismaCloud().application.provision (once-per-lowering hook)', () => {
  test('default stage: references PRISMA_PROJECT_ID (no Project minted), poisons DATABASE_URL + DATABASE_URL_POOLED with "-", class production, no branchId', async () => {
    await withEnv({ PRISMA_PROJECT_ID: 'shop-project-id', PRISMA_BRANCH_ID: undefined }, () => {
      const target = prismaCloud({ workspaceId: 'ws_1' });
      const before = recorded.envVar.length;

      const result = run<LoweredNode>(
        applicationOf(target).provision({} as unknown as LowerContext),
      );

      expect(result.outputs).toEqual({ projectId: 'shop-project-id' });
      // "-", not "": the API rejects empty env-var values (verified at the R4 deploy proof).
      expect(recorded.envVar.slice(before)).toEqual([
        [
          'DATABASE_URL-poison',
          {
            projectId: 'shop-project-id',
            key: 'DATABASE_URL',
            value: '-',
            class: 'production',
          },
        ],
        [
          'DATABASE_URL_POOLED-poison',
          {
            projectId: 'shop-project-id',
            key: 'DATABASE_URL_POOLED',
            value: '-',
            class: 'production',
          },
        ],
      ]);
    });
  });

  test('named stage (PRISMA_BRANCH_ID set): poison env vars carry class "preview" and branchId', async () => {
    await withEnv({ PRISMA_PROJECT_ID: 'shop-project-id', PRISMA_BRANCH_ID: 'branch_1' }, () => {
      const target = prismaCloud({ workspaceId: 'ws_1' });
      const before = recorded.envVar.length;

      const result = run<LoweredNode>(
        applicationOf(target).provision({} as unknown as LowerContext),
      );

      expect(result.outputs).toEqual({ projectId: 'shop-project-id' });
      expect(recorded.envVar.slice(before)).toEqual([
        [
          'DATABASE_URL-poison',
          {
            projectId: 'shop-project-id',
            key: 'DATABASE_URL',
            value: '-',
            class: 'preview',
            branchId: 'branch_1',
          },
        ],
        [
          'DATABASE_URL_POOLED-poison',
          {
            projectId: 'shop-project-id',
            key: 'DATABASE_URL_POOLED',
            value: '-',
            class: 'preview',
            branchId: 'branch_1',
          },
        ],
      ]);
    });
  });

  test('fails with the required-variable error when PRISMA_PROJECT_ID is missing', async () => {
    await withEnv({ PRISMA_PROJECT_ID: undefined, PRISMA_BRANCH_ID: undefined }, () => {
      const target = prismaCloud({ workspaceId: 'ws_1' });

      expect(() =>
        run<LoweredNode>(applicationOf(target).provision({} as unknown as LowerContext)),
      ).toThrow(/PRISMA_PROJECT_ID/);
    });
  });
});

describe("prismaCloud().nodes['postgres'] — the resource control", () => {
  test("creates a Database + Connection in the application's project; url unwraps the Redacted connection string", async () => {
    await withEnv({ PRISMA_BRANCH_ID: undefined }, () => {
      const target = prismaCloud({ workspaceId: 'ws_1' });
      // ctx.id is the system provision id — one Database per provisioned resource.
      const ctx = {
        id: 'data',
        application: { outputs: { projectId: 'shop-project#cloud-id' } },
      } as unknown as LowerContext;

      const result = run<LoweredNode>(resourceControlOf(target, 'postgres')(ctx));

      expect(result.outputs).toEqual({ url: 'postgres://data-conn' });
      expect(recorded.db).toEqual([
        ['data-db', { projectId: 'shop-project#cloud-id', name: 'data', region: 'us-east-1' }],
      ]);
      expect(recorded.conn).toEqual([
        ['data-conn', { databaseId: 'data-db#cloud-id', name: 'data' }],
      ]);
    });
  });

  test('named stage (PRISMA_BRANCH_ID set): Database is created with branchId', async () => {
    await withEnv({ PRISMA_BRANCH_ID: 'branch_1' }, () => {
      const target = prismaCloud({ workspaceId: 'ws_1' });
      const ctx = {
        id: 'data2',
        application: { outputs: { projectId: 'shop-project#cloud-id' } },
      } as unknown as LowerContext;
      const before = recorded.db.length;

      run<LoweredNode>(resourceControlOf(target, 'postgres')(ctx));

      expect(recorded.db.slice(before)).toEqual([
        [
          'data2-db',
          {
            projectId: 'shop-project#cloud-id',
            name: 'data2',
            region: 'us-east-1',
            branchId: 'branch_1',
          },
        ],
      ]);
    });
  });
});

describe("prismaCloud().nodes['compute'] — the service control", () => {
  test("provision creates a ComputeService inside the application's project", async () => {
    await withEnv({ PRISMA_BRANCH_ID: undefined }, () => {
      const target = prismaCloud({ workspaceId: 'ws_1' });
      const ctx = {
        id: 'auth',
        application: { outputs: { projectId: 'shop-project#cloud-id' } },
      } as unknown as LowerContext;

      const result = run<LoweredNode>(serviceControlOf(target, 'compute').provision(ctx));

      expect(result.outputs).toEqual({
        serviceId: 'auth-svc#cloud-id',
        projectId: 'shop-project#cloud-id',
      });
      expect(recorded.svc).toEqual([
        ['auth-svc', { projectId: 'shop-project#cloud-id', name: 'auth', region: 'us-east-1' }],
      ]);
    });
  });

  test('named stage (PRISMA_BRANCH_ID set): provision creates a ComputeService with branchId', async () => {
    await withEnv({ PRISMA_BRANCH_ID: 'branch_1' }, () => {
      const target = prismaCloud({ workspaceId: 'ws_1' });
      const ctx = {
        id: 'auth2',
        application: { outputs: { projectId: 'shop-project#cloud-id' } },
      } as unknown as LowerContext;
      const before = recorded.svc.length;

      run<LoweredNode>(serviceControlOf(target, 'compute').provision(ctx));

      expect(recorded.svc.slice(before)).toEqual([
        [
          'auth2-svc',
          {
            projectId: 'shop-project#cloud-id',
            name: 'auth2',
            region: 'us-east-1',
            branchId: 'branch_1',
          },
        ],
      ]);
    });
  });

  test('serialize writes one env var per Config leaf, keyed by configKey(address, decl)', async () => {
    await withEnv({ PRISMA_BRANCH_ID: undefined }, () => {
      const target = prismaCloud({ workspaceId: 'ws_1' });
      const node = compute({
        name: 'test-service',
        deps: {
          db: postgres(),
        },
        build: {
          extension: '@prisma/app-node',
          type: 'node',
          module: 'file:///test/service.ts',
          entry: 'server.js',
        },
      });
      const ctx = { address: 'auth', node } as unknown as LowerContext;
      const provisioned: LoweredNode = {
        outputs: { serviceId: 'auth-svc#cloud-id', projectId: 'shop-project#cloud-id' },
      };
      const config = { service: { port: 3000 }, inputs: { db: { url: 'postgres://real-db' } } };

      const result = run<LoweredNode>(
        serviceControlOf(target, 'compute').serialize(ctx, provisioned, config),
      );

      expect(recorded.envVar.slice(-2)).toEqual([
        [
          'AUTH_DB_URL-var',
          {
            projectId: 'shop-project#cloud-id',
            key: 'AUTH_DB_URL',
            value: 'postgres://real-db',
            class: 'production',
          },
        ],
        // The concrete numeric leaf is encoded typed→string ("3000", not 3000):
        // the ConfigVariable value field is string-typed, and deserialize reads
        // it back to a number (round-tripped in pack.test.ts).
        [
          'AUTH_PORT-var',
          {
            projectId: 'shop-project#cloud-id',
            key: 'AUTH_PORT',
            value: '3000',
            class: 'production',
          },
        ],
      ]);
      expect(result.outputs['environment']).toEqual([
        { id: 'AUTH_DB_URL-var#cloud-id', key: 'AUTH_DB_URL' },
        { id: 'AUTH_PORT-var#cloud-id', key: 'AUTH_PORT' },
      ]);
      // serialize also surfaces the resolved listen port for deploy() — the
      // Deployment must route to whatever the app binds, not a constant.
      expect(result.outputs['port']).toBe(3000);
    });
  });

  test('named stage (PRISMA_BRANCH_ID set): serialize writes env vars with class "preview" and branchId', async () => {
    await withEnv({ PRISMA_BRANCH_ID: 'branch_1' }, () => {
      const target = prismaCloud({ workspaceId: 'ws_1' });
      const node = compute({
        name: 'test-service',
        deps: {},
        build: {
          extension: '@prisma/app-node',
          type: 'node',
          module: 'file:///test/service.ts',
          entry: 'server.js',
        },
      });
      const ctx = { address: 'auth3', node } as unknown as LowerContext;
      const provisioned: LoweredNode = { outputs: { projectId: 'shop-project#cloud-id' } };
      const config = { service: { port: 3000 }, inputs: {} };
      const before = recorded.envVar.length;

      run<LoweredNode>(serviceControlOf(target, 'compute').serialize(ctx, provisioned, config));

      expect(recorded.envVar.slice(before)).toEqual([
        [
          'AUTH3_PORT-var',
          {
            projectId: 'shop-project#cloud-id',
            key: 'AUTH3_PORT',
            value: '3000',
            class: 'preview',
            branchId: 'branch_1',
          },
        ],
      ]);
    });
  });

  test('serialize surfaces a non-default port so deploy routes to it', async () => {
    await withEnv({ PRISMA_BRANCH_ID: undefined }, () => {
      const target = prismaCloud({ workspaceId: 'ws_1' });
      const node = compute({
        name: 'test-service',
        deps: {},
        build: {
          extension: '@prisma/app-node',
          type: 'node',
          module: 'file:///test/service.ts',
          entry: 'server.js',
        },
      });
      const ctx = { address: 'auth', node } as unknown as LowerContext;
      const provisioned: LoweredNode = { outputs: { projectId: 'shop-project#cloud-id' } };
      // A port other than the pack default: serialize must carry 8080 through,
      // not silently normalize it back to 3000.
      const config = { service: { port: 8080 }, inputs: {} };

      const result = run<LoweredNode>(
        serviceControlOf(target, 'compute').serialize(ctx, provisioned, config),
      );

      expect(result.outputs['port']).toBe(8080);
    });
  });

  test("package delegates to prisma-alchemy's deterministic artifact packager", () => {
    const target = prismaCloud({ workspaceId: 'ws_1' });
    const ctx = { id: 'auth' } as unknown as LowerContext;

    const result = run(
      serviceControlOf(target, 'compute').package(ctx, {
        assembled: { dir: 'systems/auth/dist/bundle', entry: 'server.js' },
        address: 'auth',
      }),
    );

    expect(recorded.pkg).toEqual([
      [
        {
          id: 'auth',
          bundleDir: 'systems/auth/dist/bundle',
          appEntry: 'server.js',
          address: 'auth',
        },
      ],
    ]);
    expect(result).toEqual({ path: '/tmp/auth.tar.gz', sha256: 'sha-auth' });
  });

  test("deploy's environment prop IS serialize's returned records — the edge that kills PRO-211", () => {
    const target = prismaCloud({ workspaceId: 'ws_1' });
    const ctx = { id: 'auth' } as unknown as LowerContext;
    const provisioned: LoweredNode = {
      outputs: { serviceId: 'auth-svc#cloud-id', projectId: 'shop-project#cloud-id' },
    };
    const artifact = { path: '/tmp/auth.tar.gz', sha256: 'sha-auth' };
    const serialized: LoweredNode = {
      outputs: {
        environment: [{ id: 'AUTH_DB_URL-var#cloud-id', key: 'AUTH_DB_URL' }],
        // A non-default port from serialize must reach the Deployment verbatim.
        port: 8080,
      },
    };

    const result = run<LoweredNode>(
      serviceControlOf(target, 'compute').deploy(ctx, provisioned, artifact, serialized),
    );

    expect(recorded.deploy).toEqual([
      [
        'auth-deploy',
        {
          computeServiceId: 'auth-svc#cloud-id',
          artifactPath: '/tmp/auth.tar.gz',
          artifactHash: 'sha-auth',
          environment: serialized.outputs['environment'],
          port: 8080,
        },
      ],
    ]);
    expect(result.outputs).toEqual({
      url: 'https://auth-deploy.example',
      projectId: 'shop-project#cloud-id',
    });
  });
});

describe('sharing: one system-provisioned postgres, two compute consumers — through core lowering()', () => {
  test("ONE Database + Connection; both services' env writes carry its url under their own keys", async () => {
    await withEnv(
      { PRISMA_PROJECT_ID: 'shop-project#cloud-id', PRISMA_BRANCH_ID: undefined },
      () => {
        const target = prismaCloud({ workspaceId: 'ws_1' });
        const build = {
          extension: '@prisma/app-node',
          type: 'node',
          module: 'file:///test/service.ts',
          entry: 'server.js',
        };
        const root = system('shop', {}, ({ provision }) => {
          const db = provision('data', postgres({ name: 'data' }));
          provision('auth', compute({ name: 'auth', deps: { main: postgres() }, build }), {
            main: db,
          });
          provision('billing', compute({ name: 'billing', deps: { store: postgres() }, build }), {
            store: db,
          });
          return {};
        });
        const before = {
          db: recorded.db.length,
          conn: recorded.conn.length,
          envVar: recorded.envVar.length,
        };

        run<LoweredNode>(
          lowering(root, configFor(target), {
            name: 'shop',
            bundles: {
              auth: { dir: 'systems/auth/dist/bundle', entry: 'server.js' },
              billing: { dir: 'systems/billing/dist/bundle', entry: 'server.js' },
            },
          }),
        );

        expect(recorded.db.slice(before.db)).toEqual([
          ['data-db', { projectId: 'shop-project#cloud-id', name: 'data', region: 'us-east-1' }],
        ]);
        expect(recorded.conn.slice(before.conn)).toEqual([
          ['data-conn', { databaseId: 'data-db#cloud-id', name: 'data' }],
        ]);

        const writes = recorded.envVar.slice(before.envVar).map(([, props]) => props);
        expect(writes).toContainEqual({
          projectId: 'shop-project#cloud-id',
          key: 'AUTH_MAIN_URL',
          value: 'postgres://data-conn',
          class: 'production',
        });
        expect(writes).toContainEqual({
          projectId: 'shop-project#cloud-id',
          key: 'BILLING_STORE_URL',
          value: 'postgres://data-conn',
          class: 'production',
        });
      },
    );
  });
});

describe('name validation — fail fast on Prisma name constraints, before creating anything', () => {
  const build = {
    extension: '@prisma/app-node',
    type: 'node',
    module: 'file:///test/service.ts',
    entry: 'server.js',
  };
  const bundles = { auth: { dir: 'systems/auth/dist/bundle', entry: 'server.js' } };

  // The plain throw validateName raises becomes an Effect defect; run() (runSync)
  // re-raises it synchronously — exactly what `lower()`'s Effect.orDie surfaces
  // at deploy. Capture it directly rather than through the typed error channel.
  const lowerError = (eff: Effect.Effect<unknown, unknown, unknown>): Error => {
    try {
      run(eff);
    } catch (e) {
      return e as Error;
    }
    throw new Error('expected lowering to throw');
  };

  test('a too-short postgres provision id throws the framework error at lower time, before any Database is recorded', async () => {
    await withEnv({ PRISMA_PROJECT_ID: 'shop-project#cloud-id' }, () => {
      const target = prismaCloud({ workspaceId: 'ws_1' });
      const root = system('shop', {}, ({ provision }) => {
        const db = provision('db', postgres({ name: 'db' }));
        provision('auth', compute({ name: 'auth', deps: { main: postgres() }, build }), {
          main: db,
        });
        return {};
      });
      const before = recorded.db.length;

      const error = lowerError(lowering(root, configFor(target), { name: 'shop', bundles }));

      // A framework authoring error naming the id and the constraint — not a raw PrismaApiError.
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('resource name (from provision id) "db"');
      expect(error.message).toContain('3–65 characters');
      expect(error.message).not.toContain('PrismaApiError');
      // It failed BEFORE creating the Database (strictly better than the mid-deploy API error).
      expect(recorded.db.length).toBe(before);
    });
  });

  test('a too-short service provision id throws the framework error naming the service name', async () => {
    await withEnv({ PRISMA_PROJECT_ID: 'shop-project#cloud-id' }, () => {
      const target = prismaCloud({ workspaceId: 'ws_1' });
      const root = system('shop', {}, ({ provision }) => {
        provision('a', compute({ name: 'a', deps: {}, build }));
        return {};
      });
      const before = recorded.svc.length;

      const error = lowerError(
        lowering(root, configFor(target), { name: 'shop', bundles: { a: bundles.auth } }),
      );

      expect(error.message).toContain('service name (from provision id) "a"');
      expect(error.message).toContain('3–65 characters');
      expect(recorded.svc.length).toBe(before);
    });
  });

  test('a valid-name system lowers unchanged — no throw, the Database is created', async () => {
    await withEnv({ PRISMA_PROJECT_ID: 'shop-project#cloud-id' }, () => {
      const target = prismaCloud({ workspaceId: 'ws_1' });
      const root = system('shop', {}, ({ provision }) => {
        const db = provision('data', postgres({ name: 'data' }));
        provision('auth', compute({ name: 'auth', deps: { main: postgres() }, build }), {
          main: db,
        });
        return {};
      });
      const before = recorded.db.length;

      expect(() =>
        run<LoweredNode>(lowering(root, configFor(target), { name: 'shop', bundles })),
      ).not.toThrow();
      expect(recorded.db.length).toBe(before + 1);
    });
  });
});
