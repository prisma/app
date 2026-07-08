import { describe, expect, test } from 'bun:test';
import { type } from 'arktype';
import { makeClient } from '../client.ts';
import { contract } from '../contract.ts';
import { rpc } from '../rpc.ts';

const authContract = contract({
  verify: rpc({ input: type({ token: 'string' }), output: type({ ok: 'boolean' }) }),
});

describe('makeClient()', () => {
  test('POSTs JSON to <url>/rpc/<method> and returns the validated output', async () => {
    const requests: Request[] = [];
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: async (req) => {
        requests.push(req);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    const result = await client.verify({ token: 't' });

    expect(result).toEqual({ ok: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toBe('http://auth.internal/rpc/verify');
    expect(await requests[0]?.json()).toEqual({ token: 't' });
  });

  test('rejects a response that fails the output schema — a lying server is caught', async () => {
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: async () =>
        new Response(JSON.stringify({ ok: 'not-a-boolean' }), {
          headers: { 'content-type': 'application/json' },
        }),
    });

    await expect(client.verify({ token: 't' })).rejects.toThrow();
  });

  test('throws naming the method when the transport responds non-OK', async () => {
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: async () => new Response('nope', { status: 500 }),
    });

    await expect(client.verify({ token: 't' })).rejects.toThrow(/verify/);
  });

  test('defaults the transport to the real fetch when none is supplied', () => {
    // No network call is made here — this only proves makeClient doesn't
    // require a transport override to construct the client.
    const client = makeClient(authContract, 'http://auth.internal');

    expect(typeof client.verify).toBe('function');
  });
});
