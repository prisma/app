import { afterEach, describe, expect, test } from 'bun:test';
import type { DependencyEnd, RunnableServiceNode } from '@internal/core';
import { dependency, service } from '@internal/core';
import { type } from 'arktype';
import { makeClient } from '../client.ts';
import { contract } from '../contract.ts';
import { rpc } from '../rpc.ts';
import {
  MAX_BODY_BYTES,
  REPLAY_CACHE_MAX_ENTRIES,
  RPC_ACCEPTED_KEYS_ENV,
  serve,
} from '../serve.ts';

const authContract = contract({
  verify: rpc({ input: type({ token: 'string' }), output: type({ ok: 'boolean' }) }),
});

interface FakeDb {
  readonly validTokens: readonly string[];
}

/**
 * A fake RunnableServiceNode exposing authContract — stands in for compute()'s
 * node. `db` hydrates through a real DependencyEnd (not an override cast), so
 * `load()`'s return is a genuine `Loaded<D, P>`, matching production shape.
 */
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

  return {
    ...node,
    run: (_address: string, boot: () => Promise<unknown>) => boot(),
    load: () => ({ db: load() }),
  } as unknown as RunnableServiceNode<
    typeof node.inputs,
    typeof node.params,
    { rpc: typeof authContract }
  >;
}

/** A POST /rpc/verify request, defaulting to a valid idempotency key — every test below overrides only what it's testing. */
function verifyRequest(
  body: unknown,
  opts?: { readonly idempotencyKey?: string | null; readonly headers?: Record<string, string> },
): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...opts?.headers };
  const key = opts?.idempotencyKey === undefined ? 'test-key' : opts.idempotencyKey;
  if (key !== null) headers['idempotency-key'] = key;
  return new Request('http://auth.internal/rpc/verify', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('serve()', () => {
  test('round trip: a valid call reaches the handler and returns the typed result', async () => {
    const authService = fakeAuthService(() => ({ validTokens: ['good-token'] }));
    const handler = serve(authService, {
      rpc: { verify: async ({ token }, { db }) => ({ ok: db.validTokens.includes(token) }) },
    });
    const client = makeClient(authContract, 'http://auth.internal', { fetch: handler });

    await expect(client.verify({ token: 'good-token' })).resolves.toEqual({ ok: true });
    await expect(client.verify({ token: 'bad-token' })).resolves.toEqual({ ok: false });
  });

  test('a bad input is rejected with 400, and the body carries the validator detail', async () => {
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, { rpc: { verify: async () => ({ ok: true }) } });

    const res = await handler(verifyRequest({ token: 123 }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.length).toBeGreaterThan(0);
    expect(body.error).toMatch(/token/i); // arktype's message names the bad field
  });

  test('an unknown method 404s', async () => {
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, { rpc: { verify: async () => ({ ok: true }) } });

    const res = await handler(
      new Request('http://auth.internal/rpc/doesNotExist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );

    expect(res.status).toBe(404);
  });

  test('a handler throw is a 500 that does not leak the exception message, and logs the real error', async () => {
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, {
      rpc: {
        verify: async () => {
          throw new Error('db credentials: hunter2');
        },
      },
    });

    const logged: unknown[][] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      const res = await handler(verifyRequest({ token: 't' }));

      expect(res.status).toBe(500);
      const bodyText = await res.text();
      expect(bodyText).not.toContain('hunter2');

      const loggedRealError = logged.some((args) =>
        args.some((arg) => arg instanceof Error && arg.message.includes('hunter2')),
      );
      expect(loggedRealError).toBe(true);
    } finally {
      console.error = originalConsoleError;
    }
  });

  test('the wrong HTTP verb on a known method is a 405', async () => {
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, { rpc: { verify: async () => ({ ok: true }) } });

    const res = await handler(new Request('http://auth.internal/rpc/verify', { method: 'GET' }));

    expect(res.status).toBe(405);
  });

  test('calls load() exactly once, not per request', async () => {
    let loadCalls = 0;
    const authService = fakeAuthService(() => {
      loadCalls += 1;
      return { validTokens: ['t'] };
    });
    const handler = serve(authService, {
      rpc: { verify: async ({ token }, { db }) => ({ ok: db.validTokens.includes(token) }) },
    });
    const client = makeClient(authContract, 'http://auth.internal', { fetch: handler });

    await client.verify({ token: 't' });
    await client.verify({ token: 't' });

    expect(loadCalls).toBe(1);
  });

  test('a handler can read ctx.idempotencyKey — it matches the caller-supplied header', async () => {
    let seenKey: string | undefined;
    const authService = fakeAuthService(() => ({ validTokens: ['good-token'] }));
    const handler = serve(authService, {
      rpc: {
        verify: async ({ token }, { db }, ctx) => {
          seenKey = ctx.idempotencyKey;
          return { ok: db.validTokens.includes(token) };
        },
      },
    });

    await handler(verifyRequest({ token: 'good-token' }, { idempotencyKey: 'caller-key-42' }));

    expect(seenKey).toBe('caller-key-42');
  });
});

describe('serve() — idempotency key requirement', () => {
  test('a request without the Idempotency-Key header is rejected with 400 naming the header', async () => {
    const authService = fakeAuthService(() => ({ validTokens: ['good-token'] }));
    const handler = serve(authService, { rpc: { verify: async () => ({ ok: true }) } });

    const res = await handler(verifyRequest({ token: 'good-token' }, { idempotencyKey: null }));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Idempotency-Key');
  });

  test('an empty Idempotency-Key header is treated as missing', async () => {
    const authService = fakeAuthService(() => ({ validTokens: ['good-token'] }));
    const handler = serve(authService, { rpc: { verify: async () => ({ ok: true }) } });

    const res = await handler(verifyRequest({ token: 'good-token' }, { idempotencyKey: '' }));

    expect(res.status).toBe(400);
  });
});

describe('serve() — idempotency dedupe', () => {
  test('a repeated key after completion replays the same response byte-identically — the handler runs once', async () => {
    let handlerCalls = 0;
    const authService = fakeAuthService(() => ({ validTokens: ['good-token'] }));
    const handler = serve(authService, {
      rpc: {
        verify: async ({ token }, { db }) => {
          handlerCalls += 1;
          return { ok: db.validTokens.includes(token) };
        },
      },
    });

    const req = () => verifyRequest({ token: 'good-token' }, { idempotencyKey: 'replay-key' });
    const first = await handler(req());
    const firstBody = await first.text();
    const second = await handler(req());
    const secondBody = await second.text();

    expect(handlerCalls).toBe(1);
    expect(second.status).toBe(first.status);
    expect(secondBody).toBe(firstBody);
  });

  test('concurrent requests sharing a key single-flight onto one execution', async () => {
    let handlerCalls = 0;
    let releaseHandler: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const authService = fakeAuthService(() => ({ validTokens: ['good-token'] }));
    const handler = serve(authService, {
      rpc: {
        verify: async ({ token }, { db }) => {
          handlerCalls += 1;
          await gate; // held open until the test releases it, below
          return { ok: db.validTokens.includes(token) };
        },
      },
    });

    const req = () => verifyRequest({ token: 'good-token' }, { idempotencyKey: 'concurrent-key' });
    const first = handler(req());
    const second = handler(req());
    releaseHandler();
    const [firstRes, secondRes] = await Promise.all([first, second]);

    expect(handlerCalls).toBe(1);
    expect(await firstRes.text()).toBe(await secondRes.text());
  });

  test('a 5xx response is not cached — a same-key retry re-executes the handler', async () => {
    let handlerCalls = 0;
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, {
      rpc: {
        verify: async () => {
          handlerCalls += 1;
          throw new Error('db unreachable');
        },
      },
    });

    const req = () => verifyRequest({ token: 't' }, { idempotencyKey: 'failing-key' });
    const first = await handler(req());
    const second = await handler(req());

    expect(first.status).toBe(500);
    expect(second.status).toBe(500);
    expect(handlerCalls).toBe(2);
  });

  test('the replay cache is LRU-bounded — the oldest entry is evicted once the bound is exceeded', async () => {
    let handlerCalls = 0;
    const authService = fakeAuthService(() => ({ validTokens: ['good-token'] }));
    const handler = serve(authService, {
      rpc: {
        verify: async ({ token }, { db }) => {
          handlerCalls += 1;
          return { ok: db.validTokens.includes(token) };
        },
      },
    });

    const call = (key: string) =>
      handler(verifyRequest({ token: 'good-token' }, { idempotencyKey: key }));

    await call('key-0');
    for (let i = 1; i <= REPLAY_CACHE_MAX_ENTRIES; i++) {
      await call(`key-${i}`); // pushes key-0 out once the bound is exceeded
    }
    expect(handlerCalls).toBe(REPLAY_CACHE_MAX_ENTRIES + 1);

    await call('key-0'); // evicted — re-executes instead of replaying
    expect(handlerCalls).toBe(REPLAY_CACHE_MAX_ENTRIES + 2);

    await call(`key-${REPLAY_CACHE_MAX_ENTRIES}`); // still cached — replays
    expect(handlerCalls).toBe(REPLAY_CACHE_MAX_ENTRIES + 2);
  }, 20_000);

  test('a replayed answer cannot cross methods, even when the same idempotency key is reused', async () => {
    const dualContract = contract({
      verify: rpc({ input: type({ token: 'string' }), output: type({ ok: 'boolean' }) }),
      echo: rpc({ input: type({ note: 'string' }), output: type({ note: 'string' }) }),
    });
    const db: DependencyEnd<FakeDb> = dependency({
      name: 'db',
      type: 'fake/db',
      connection: { params: {}, hydrate: () => ({ validTokens: ['good-token'] }) },
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
      expose: { rpc: dualContract },
    });
    const dualService = {
      ...node,
      run: (_address: string, boot: () => Promise<unknown>) => boot(),
      load: () => ({ db: { validTokens: ['good-token'] } }),
    } as unknown as RunnableServiceNode<
      typeof node.inputs,
      typeof node.params,
      { rpc: typeof dualContract }
    >;

    const handler = serve(dualService, {
      rpc: {
        verify: async ({ token }, { db }) => ({ ok: db.validTokens.includes(token) }),
        echo: async ({ note }) => ({ note }),
      },
    });

    const sharedKey = 'shared-key';
    const verifyRes = await handler(
      new Request('http://auth.internal/rpc/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': sharedKey },
        body: JSON.stringify({ token: 'good-token' }),
      }),
    );
    expect(await verifyRes.json()).toEqual({ ok: true });

    const echoRes = await handler(
      new Request('http://auth.internal/rpc/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': sharedKey },
        body: JSON.stringify({ note: 'hello' }),
      }),
    );
    // Must be echo's own answer, never verify's cached { ok: true }.
    expect(await echoRes.json()).toEqual({ note: 'hello' });
  });
});

describe('serve() — request body size cap', () => {
  test('a body over the size limit is rejected with 413', async () => {
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, { rpc: { verify: async () => ({ ok: true }) } });

    const oversized = 'x'.repeat(MAX_BODY_BYTES + 1);
    const res = await handler(verifyRequest({ token: oversized }));

    expect(res.status).toBe(413);
  });

  test('the cap is enforced against bytes actually read, not content-length — a stream body with no content-length header is still capped', async () => {
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, { rpc: { verify: async () => ({ ok: true }) } });

    const oversizedJson = JSON.stringify({ token: 'x'.repeat(MAX_BODY_BYTES + 1) });
    const bytes = new TextEncoder().encode(oversizedJson);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });

    const req = new Request('http://auth.internal/rpc/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'k' },
      body,
      duplex: 'half',
    } as RequestInit);

    expect(req.headers.has('content-length')).toBe(false);

    const res = await handler(req);
    expect(res.status).toBe(413);
  });

  test('the cap is enforced even when content-length lies about being small', async () => {
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, { rpc: { verify: async () => ({ ok: true }) } });

    const oversizedJson = JSON.stringify({ token: 'x'.repeat(MAX_BODY_BYTES + 1) });
    const bytes = new TextEncoder().encode(oversizedJson);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });

    const req = new Request('http://auth.internal/rpc/verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'k',
        'content-length': '10', // a lie — the real body is far larger
      },
      body,
      duplex: 'half',
    } as RequestInit);

    const res = await handler(req);
    expect(res.status).toBe(413);
  });

  test('a body at or under the limit is accepted', async () => {
    const authService = fakeAuthService(() => ({ validTokens: ['good-token'] }));
    const handler = serve(authService, {
      rpc: { verify: async ({ token }, { db }) => ({ ok: db.validTokens.includes(token) }) },
    });

    const res = await handler(verifyRequest({ token: 'good-token' }));

    expect(res.status).toBe(200);
  });
});

describe('serve() — service-key enforcement (COMPOSER_RPC_ACCEPTED_KEYS)', () => {
  afterEach(() => {
    delete process.env[RPC_ACCEPTED_KEYS_ENV];
  });

  test('a member key dispatches normally', async () => {
    process.env[RPC_ACCEPTED_KEYS_ENV] = JSON.stringify(['good-key']);
    const authService = fakeAuthService(() => ({ validTokens: ['good-token'] }));
    const handler = serve(authService, {
      rpc: { verify: async ({ token }, { db }) => ({ ok: db.validTokens.includes(token) }) },
    });
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: handler,
      serviceKey: 'good-key',
    });

    await expect(client.verify({ token: 'good-token' })).resolves.toEqual({ ok: true });
  });

  test('a wrong key is rejected with 401 and the handler never runs', async () => {
    process.env[RPC_ACCEPTED_KEYS_ENV] = JSON.stringify(['good-key']);
    let handlerCalled = false;
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, {
      rpc: {
        verify: async () => {
          handlerCalled = true;
          return { ok: true };
        },
      },
    });

    const res = await handler(
      verifyRequest({ token: 't' }, { headers: { authorization: 'Bearer wrong-key' } }),
    );

    expect(res.status).toBe(401);
    expect(handlerCalled).toBe(false);
  });

  test('a missing key is rejected with 401 and the handler never runs', async () => {
    process.env[RPC_ACCEPTED_KEYS_ENV] = JSON.stringify(['good-key']);
    let handlerCalled = false;
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, {
      rpc: {
        verify: async () => {
          handlerCalled = true;
          return { ok: true };
        },
      },
    });

    const res = await handler(verifyRequest({ token: 't' }));

    expect(res.status).toBe(401);
    expect(handlerCalled).toBe(false);
  });

  test('401 fires before input validation — a bad-input body with no key is 401, not 400', async () => {
    process.env[RPC_ACCEPTED_KEYS_ENV] = JSON.stringify(['good-key']);
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, { rpc: { verify: async () => ({ ok: true }) } });

    const res = await handler(verifyRequest({ token: 123 }));

    expect(res.status).toBe(401);
  });

  test('401 fires before the idempotency-key requirement — a keyless request with no service key is 401, not 400', async () => {
    process.env[RPC_ACCEPTED_KEYS_ENV] = JSON.stringify(['good-key']);
    const authService = fakeAuthService(() => ({ validTokens: [] }));
    const handler = serve(authService, { rpc: { verify: async () => ({ ok: true }) } });

    const res = await handler(verifyRequest({ token: 't' }, { idempotencyKey: null }));

    expect(res.status).toBe(401);
  });

  test('a provisioned empty accepted-keys array ("[]") denies every caller — a provider with zero wired consumers', async () => {
    process.env[RPC_ACCEPTED_KEYS_ENV] = JSON.stringify([]);
    let handlerCalled = false;
    const authService = fakeAuthService(() => ({ validTokens: ['good-token'] }));
    const handler = serve(authService, {
      rpc: {
        verify: async ({ token }, { db }) => {
          handlerCalled = true;
          return { ok: db.validTokens.includes(token) };
        },
      },
    });

    const res = await handler(verifyRequest({ token: 'good-token' }));

    expect(res.status).toBe(401);
    expect(handlerCalled).toBe(false);
  });

  test('an unset accepted-keys env var passes through unchanged — the unprovisioned local/test state', async () => {
    const authService = fakeAuthService(() => ({ validTokens: ['good-token'] }));
    const handler = serve(authService, {
      rpc: { verify: async ({ token }, { db }) => ({ ok: db.validTokens.includes(token) }) },
    });

    const res = await handler(verifyRequest({ token: 'good-token' }));

    expect(res.status).toBe(200);
  });

  test('malformed JSON in the accepted-keys env var denies every caller — fails closed', async () => {
    process.env[RPC_ACCEPTED_KEYS_ENV] = 'not-json{';
    let handlerCalled = false;
    const authService = fakeAuthService(() => ({ validTokens: ['good-token'] }));
    const handler = serve(authService, {
      rpc: {
        verify: async ({ token }, { db }) => {
          handlerCalled = true;
          return { ok: db.validTokens.includes(token) };
        },
      },
    });

    const res = await handler(verifyRequest({ token: 'good-token' }));

    expect(res.status).toBe(401);
    expect(handlerCalled).toBe(false);
  });
});
