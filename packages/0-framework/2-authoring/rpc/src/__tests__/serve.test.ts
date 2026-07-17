import { afterEach, describe, expect, test } from 'bun:test';
import type { DependencyEnd, RunnableServiceNode } from '@internal/core';
import { dependency, service } from '@internal/core';
import { blindCast } from '@internal/foundation/casts';
import { ORPCError } from '@orpc/client';
import { oc } from '@orpc/contract';
import { implement } from '@orpc/server';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { type } from 'arktype';
import { makeClient } from '../client.ts';
import { contract } from '../contract.ts';
import { RPC_ACCEPTED_KEYS_ENV, serve } from '../serve.ts';

const authContract = contract({
  verify: oc.input(type({ token: 'string' })).output(type({ ok: 'boolean' })),
});
const auth = implement(authContract.router);

type VerifyHandler = Parameters<typeof auth.verify.handler>[0];

function authRouter(handler: VerifyHandler) {
  return auth.router({ verify: auth.verify.handler(handler) });
}

const rpcRequest = (
  method: string,
  input: unknown,
  init?: { headers?: Record<string, string>; verb?: string; prefix?: string },
) =>
  new Request(`http://auth.internal${init?.prefix ?? '/rpc'}/${method}`, {
    method: init?.verb ?? 'POST',
    headers: { 'content-type': 'application/json', ...init?.headers },
    body: init?.verb === 'GET' ? undefined : JSON.stringify({ json: input }),
  });

interface FakeDb {
  readonly validTokens: readonly string[];
}

/** A concrete test service with the same load/config/expose shape as Compute. */
function fakeAuthService(load: () => FakeDb) {
  const db: DependencyEnd<FakeDb> = dependency({
    name: 'db',
    type: 'fake/db',
    connection: { params: {}, hydrate: load },
  });
  const node = service({
    name: 'test-service',
    extension: 'test/pack',
    type: 'fake/rpc-test',
    inputs: { db },
    params: {},
    build: {
      extension: '@fake/adapter',
      type: 'fake',
      module: 'file:///test/service.ts',
      entry: 'x',
    },
    expose: { rpc: authContract },
  });

  return blindCast<
    RunnableServiceNode<typeof node.inputs, typeof node.params, { rpc: typeof authContract }>,
    'test service supplies the runnable run/load members that service() deliberately leaves target-specific'
  >({
    ...node,
    run: (_address: string, boot: () => Promise<unknown>) => boot(),
    load: () => ({ db: load() }),
  });
}

describe('serve() with native oRPC routers', () => {
  test('round trip: native client -> native router -> validated result', async () => {
    const authService = fakeAuthService(() => ({ validTokens: ['good-token'] }));
    const { db } = authService.load();
    const handler = serve(authService, {
      rpc: authRouter(({ input }) => ({ ok: db.validTokens.includes(input.token) })),
    });
    const client = makeClient(authContract, 'http://auth.internal', { fetch: handler });

    await expect(client.verify({ token: 'good-token' })).resolves.toEqual({ ok: true });
    await expect(client.verify({ token: 'bad-token' })).resolves.toEqual({ ok: false });
  });

  test('rejects bad input through the native oRPC contract schema', async () => {
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, { rpc: authRouter(() => ({ ok: true })) });

    const res = await handler(rpcRequest('verify', { token: 123 }));

    expect(res.status).toBe(400);
  });

  test('returns 404 for an unknown procedure', async () => {
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, { rpc: authRouter(() => ({ ok: true })) });

    const res = await handler(rpcRequest('doesNotExist', {}));

    expect(res.status).toBe(404);
  });

  test('masks an unexpected handler exception', async () => {
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, {
      rpc: authRouter(() => {
        throw new Error('db unreachable');
      }),
    });

    const res = await handler(rpcRequest('verify', { token: 't' }));

    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain('db unreachable');
  });

  test('returns 405 for the wrong verb on a known procedure', async () => {
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, { rpc: authRouter(() => ({ ok: true })) });

    const res = await handler(rpcRequest('verify', undefined, { verb: 'GET' }));

    expect(res.status).toBe(405);
  });

  test('rejects a router implemented from a different contract instance', () => {
    const structurallyEqual = contract({
      verify: oc.input(type({ token: 'string' })).output(type({ ok: 'boolean' })),
    });
    const other = implement(structurallyEqual.router);
    const wrongRouter = other.router({
      verify: other.verify.handler(() => ({ ok: true })),
    });
    const authService = fakeAuthService(() => ({ validTokens: [] }));

    expect(() => serve(authService, { rpc: wrongRouter })).toThrow(/exact contract\.router/);
  });

  test('never exposes procedures added outside the topology contract', async () => {
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const router = Object.assign(
      authRouter(() => ({ ok: true })),
      {
        admin: auth.verify.handler(() => ({ ok: true })),
      },
    );
    const handler = serve(authService, { rpc: router });

    const declared = await handler(rpcRequest('verify', { token: 't' }));
    const undeclared = await handler(rpcRequest('admin', { token: 't' }));

    expect(declared.status).toBe(200);
    expect(undeclared.status).toBe(404);
  });

  test('preserves native nested router paths', async () => {
    const nestedContract = contract({
      session: {
        revoke: oc.input(type({ id: 'string' })).output(type({ revoked: 'boolean' })),
      },
    });
    const os = implement(nestedContract.router);
    const router = os.router({
      session: os.session.router({
        revoke: os.session.revoke.handler(({ input }) => ({ revoked: input.id.length > 0 })),
      }),
    });
    const base = fakeAuthService(() => ({ validTokens: [] }));
    const nestedService = blindCast<
      RunnableServiceNode<typeof base.inputs, typeof base.params, { rpc: typeof nestedContract }>,
      'test replaces only the exposed contract on an otherwise complete runnable service'
    >({ ...base, expose: { rpc: nestedContract } });
    const handler = serve(nestedService, { rpc: router });
    const client = makeClient(nestedContract, 'http://auth.internal', { fetch: handler });

    await expect(client.session.revoke({ id: 'session-1' })).resolves.toEqual({ revoked: true });
  });
});

describe('serve() service-key enforcement', () => {
  afterEach(() => {
    delete process.env[RPC_ACCEPTED_KEYS_ENV];
  });

  test('accepts a member key', async () => {
    process.env[RPC_ACCEPTED_KEYS_ENV] = JSON.stringify(['good-key']);
    const authService = fakeAuthService(() => ({ validTokens: ['good-token'] }));
    const handler = serve(authService, {
      rpc: authRouter(({ input }) => ({ ok: input.token === 'good-token' })),
    });
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: handler,
      serviceKey: 'good-key',
    });

    await expect(client.verify({ token: 'good-token' })).resolves.toEqual({ ok: true });
  });

  test('rejects a wrong key before dispatch', async () => {
    process.env[RPC_ACCEPTED_KEYS_ENV] = JSON.stringify(['good-key']);
    let called = false;
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, {
      rpc: authRouter(() => {
        called = true;
        return { ok: true };
      }),
    });

    const res = await handler(
      rpcRequest('verify', { token: 't' }, { headers: { authorization: 'Bearer wrong-key' } }),
    );

    expect(res.status).toBe(401);
    expect(called).toBe(false);
  });

  test('rejects a missing key before input validation', async () => {
    process.env[RPC_ACCEPTED_KEYS_ENV] = JSON.stringify(['good-key']);
    let called = false;
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, {
      rpc: authRouter(() => {
        called = true;
        return { ok: true };
      }),
    });

    const res = await handler(rpcRequest('verify', { token: 123 }));

    expect(res.status).toBe(401);
    expect(called).toBe(false);
  });

  test('a provisioned empty key set denies every caller', async () => {
    process.env[RPC_ACCEPTED_KEYS_ENV] = JSON.stringify([]);
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, { rpc: authRouter(() => ({ ok: true })) });

    expect((await handler(rpcRequest('verify', { token: 't' }))).status).toBe(401);
  });

  test('an unset key set is the open local/test state', async () => {
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, { rpc: authRouter(() => ({ ok: true })) });

    expect((await handler(rpcRequest('verify', { token: 't' }))).status).toBe(200);
  });

  test('malformed JSON fails closed', async () => {
    process.env[RPC_ACCEPTED_KEYS_ENV] = 'not-json{';
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, { rpc: authRouter(() => ({ ok: true })) });

    expect((await handler(rpcRequest('verify', { token: 't' }))).status).toBe(401);
  });

  test('a configured empty string fails closed', async () => {
    process.env[RPC_ACCEPTED_KEYS_ENV] = '';
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, { rpc: authRouter(() => ({ ok: true })) });

    expect((await handler(rpcRequest('verify', { token: 't' }))).status).toBe(401);
  });

  test('an empty key inside the configured set fails closed', async () => {
    process.env[RPC_ACCEPTED_KEYS_ENV] = JSON.stringify(['']);
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, { rpc: authRouter(() => ({ ok: true })) });

    expect((await handler(rpcRequest('verify', { token: 't' }))).status).toBe(401);
  });
});

describe('serve() production transport behavior', () => {
  test('round-trips an intentional oRPC error code and public message', async () => {
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, {
      rpc: authRouter(() => {
        throw new ORPCError('CONFLICT', { message: 'token was already consumed' });
      }),
    });
    const client = makeClient(authContract, 'http://auth.internal', { fetch: handler });

    try {
      await client.verify({ token: 't' });
      throw new Error('expected the RPC call to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ORPCError);
      if (!(error instanceof ORPCError)) throw error;
      expect(error.code).toBe('CONFLICT');
      expect(error.message).toBe('token was already consumed');
    }
  });

  test('rejects an invalid native handler result at the provider boundary', async () => {
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, {
      rpc: authRouter(() =>
        blindCast<
          { ok: boolean },
          'test deliberately violates the declared output at runtime to prove provider validation'
        >({ ok: 'not-a-boolean' }),
      ),
    });

    const response = await handler(rpcRequest('verify', { token: 't' }));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('not-a-boolean');
  });

  test('applies Standard Schema input/output transforms once through native oRPC', async () => {
    const input: StandardSchemaV1<string, number> = {
      '~standard': {
        version: 1,
        vendor: 'composer-test',
        validate: async (value) =>
          typeof value === 'string'
            ? { value: Number(value) }
            : { issues: [{ message: 'expected a string' }] },
      },
    };
    const output: StandardSchemaV1<{ doubled: number }, { doubled: string }> = {
      '~standard': {
        version: 1,
        vendor: 'composer-test',
        validate: async (value) =>
          typeof value === 'object' &&
          value !== null &&
          'doubled' in value &&
          typeof value.doubled === 'number'
            ? { value: { doubled: String(value.doubled) } }
            : { issues: [{ message: 'expected a numeric doubled field' }] },
      },
    };
    const transformedContract = contract({ transform: oc.input(input).output(output) });
    const os = implement(transformedContract.router);
    const router = os.router({
      transform: os.transform.handler(({ input: value }) => ({ doubled: value * 2 })),
    });
    const base = fakeAuthService(() => ({ validTokens: [] }));
    const transformedService = blindCast<
      RunnableServiceNode<
        typeof base.inputs,
        typeof base.params,
        { rpc: typeof transformedContract }
      >,
      'test replaces only the exposed contract on an otherwise complete runnable service'
    >({ ...base, expose: { rpc: transformedContract } });
    const handler = serve(transformedService, { rpc: router });
    const client = makeClient(transformedContract, 'http://auth.internal', { fetch: handler });

    await expect(client.transform('21')).resolves.toEqual({ doubled: '42' });
  });

  test('rejects a body above the configured byte limit', async () => {
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(
      authService,
      { rpc: authRouter(() => ({ ok: true })) },
      { maxBodySize: 16 },
    );

    const res = await handler(rpcRequest('verify', { token: 'body-that-is-too-large' }));

    expect(res.status).toBe(413);
  });

  test('supports an explicit mount prefix without path guessing', async () => {
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(
      authService,
      { rpc: authRouter(() => ({ ok: true })) },
      { prefix: '/api/v1/rpc' },
    );

    const mounted = await handler(rpcRequest('verify', { token: 't' }, { prefix: '/api/v1/rpc' }));
    const defaultPath = await handler(rpcRequest('verify', { token: 't' }));

    expect(mounted.status).toBe(200);
    expect(defaultPath.status).toBe(404);
  });

  test('rejects duplicate native procedure paths across exposed ports', () => {
    const secondContract = contract({
      verify: oc.input(type({ token: 'string' })).output(type({ ok: 'boolean' })),
    });
    const second = implement(secondContract.router);
    const secondRouter = second.router({
      verify: second.verify.handler(() => ({ ok: true })),
    });
    const base = fakeAuthService(() => ({ validTokens: [] }));
    const multiPortService = blindCast<
      RunnableServiceNode<
        typeof base.inputs,
        typeof base.params,
        { rpc: typeof authContract; admin: typeof secondContract }
      >,
      'test replaces only the exposed contracts on an otherwise complete runnable service'
    >({ ...base, expose: { rpc: authContract, admin: secondContract } });

    expect(() =>
      serve(multiPortService, {
        rpc: authRouter(() => ({ ok: true })),
        admin: secondRouter,
      }),
    ).toThrow(/procedure path "verify"/);
  });

  test('distinguishes an encoded slash in one segment from a nested path', async () => {
    const slashContract = contract({
      'a/b': oc.input(type({})).output(type({ route: "'slash'" })),
    });
    const nestedContract = contract({
      a: { b: oc.input(type({})).output(type({ route: "'nested'" })) },
    });
    const slash = implement(slashContract.router);
    const nested = implement(nestedContract.router);
    const slashRouter = slash.router({
      'a/b': slash['a/b'].handler(() => ({ route: 'slash' })),
    });
    const nestedRouter = nested.router({
      a: nested.a.router({
        b: nested.a.b.handler(() => ({ route: 'nested' })),
      }),
    });
    const base = fakeAuthService(() => ({ validTokens: [] }));
    const serviceWithBoth = blindCast<
      RunnableServiceNode<
        typeof base.inputs,
        typeof base.params,
        { slash: typeof slashContract; nested: typeof nestedContract }
      >,
      'test replaces only the exposed contracts on an otherwise complete runnable service'
    >({ ...base, expose: { slash: slashContract, nested: nestedContract } });
    const handler = serve(serviceWithBoth, { slash: slashRouter, nested: nestedRouter });

    const slashResponse = await handler(rpcRequest('a%2Fb', {}));
    const nestedResponse = await handler(rpcRequest('a/b', {}));

    expect(slashResponse.status).toBe(200);
    expect(nestedResponse.status).toBe(200);
  });
});
