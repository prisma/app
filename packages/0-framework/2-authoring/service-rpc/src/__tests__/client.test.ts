import { describe, expect, test } from 'bun:test';
import { type } from 'arktype';
import { makeClient } from '../client.ts';
import { contract } from '../contract.ts';
import { rpc } from '../rpc.ts';

const authContract = contract({
  verify: rpc({ input: type({ token: 'string' }), output: type({ ok: 'boolean' }) }),
});

const okResponse = () =>
  new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });

describe('makeClient()', () => {
  test('POSTs JSON to <url>/rpc/<method> and returns the parsed response', async () => {
    const requests: Request[] = [];
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: async (req) => {
        requests.push(req);
        return okResponse();
      },
    });

    const result = await client.verify({ token: 't' });

    expect(result).toEqual({ ok: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toBe('http://auth.internal/rpc/verify');
    expect(await requests[0]?.json()).toEqual({ token: 't' });
  });

  test('a base URL with its own path is preserved, not dropped — a leading-slash-free join', async () => {
    const requests: Request[] = [];
    const client = makeClient(authContract, 'http://auth.internal/api/v1', {
      fetch: async (req) => {
        requests.push(req);
        return okResponse();
      },
    });

    await client.verify({ token: 't' });

    expect(requests[0]?.url).toBe('http://auth.internal/api/v1/rpc/verify');
  });

  test('throws naming the method when the transport responds with a non-retryable non-OK status', async () => {
    // 400 (not 500 — a 5xx would now retry, see the idempotency-key tests below).
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: async () => new Response('nope', { status: 400 }),
    });

    await expect(client.verify({ token: 't' })).rejects.toThrow(/verify/);
  });

  test("a non-2xx response's { error } body is folded into the thrown message", async () => {
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: async () =>
        new Response(JSON.stringify({ error: 'token expired' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    });

    await expect(client.verify({ token: 't' })).rejects.toThrow(/token expired/);
  });

  test('defaults the transport to the real fetch when none is supplied', () => {
    // No network call is made here — this only proves makeClient doesn't
    // require a transport override to construct the client.
    const client = makeClient(authContract, 'http://auth.internal');

    expect(typeof client.verify).toBe('function');
  });

  test('a serviceKey adds Authorization: Bearer <key> to every request', async () => {
    const requests: Request[] = [];
    const client = makeClient(authContract, 'http://auth.internal', {
      serviceKey: 'edge-key',
      fetch: async (req) => {
        requests.push(req);
        return okResponse();
      },
    });

    await client.verify({ token: 't' });

    expect(requests[0]?.headers.get('authorization')).toBe('Bearer edge-key');
  });

  test('no serviceKey means no Authorization header', async () => {
    const requests: Request[] = [];
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: async (req) => {
        requests.push(req);
        return okResponse();
      },
    });

    await client.verify({ token: 't' });

    expect(requests[0]?.headers.has('authorization')).toBe(false);
  });
});

describe('makeClient() — idempotency key and retry', () => {
  test('every request carries a non-empty Idempotency-Key header', async () => {
    const requests: Request[] = [];
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: async (req) => {
        requests.push(req);
        return okResponse();
      },
    });

    await client.verify({ token: 't' });

    expect(requests[0]?.headers.get('idempotency-key')).toBeTruthy();
  });

  test('two separate logical calls mint two different keys', async () => {
    const requests: Request[] = [];
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: async (req) => {
        requests.push(req);
        return okResponse();
      },
    });

    await client.verify({ token: 'a' });
    await client.verify({ token: 'b' });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.headers.get('idempotency-key')).not.toBe(
      requests[1]?.headers.get('idempotency-key'),
    );
  });

  test('a 503 then success resolves after exactly two requests, both carrying the same key', async () => {
    const requests: Request[] = [];
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: async (req) => {
        requests.push(req);
        return requests.length === 1 ? new Response('cold', { status: 503 }) : okResponse();
      },
    });

    await expect(client.verify({ token: 't' })).resolves.toEqual({ ok: true });

    expect(requests).toHaveLength(2);
    const firstKey = requests[0]?.headers.get('idempotency-key');
    const secondKey = requests[1]?.headers.get('idempotency-key');
    expect(firstKey).toBeTruthy();
    expect(firstKey).toBe(secondKey);
  });

  test('a 429 is retried the same as a 5xx', async () => {
    const requests: Request[] = [];
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: async (req) => {
        requests.push(req);
        return requests.length === 1 ? new Response('slow down', { status: 429 }) : okResponse();
      },
    });

    await expect(client.verify({ token: 't' })).resolves.toEqual({ ok: true });
    expect(requests).toHaveLength(2);
  });

  test('a thrown network error is retried and the call still resolves', async () => {
    let calls = 0;
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: async () => {
        calls += 1;
        if (calls === 1) throw new Error('socket reset');
        return okResponse();
      },
    });

    await expect(client.verify({ token: 't' })).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  test('a 404 rejects after exactly one request — no background retry follows', async () => {
    const requests: Request[] = [];
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: async (req) => {
        requests.push(req);
        return new Response(JSON.stringify({ error: 'unknown method' }), { status: 404 });
      },
    });

    await expect(client.verify({ token: 't' })).rejects.toThrow();
    expect(requests).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 300)); // a retry would land here
    expect(requests).toHaveLength(1);
  });
});
