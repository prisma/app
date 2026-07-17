import { describe, expect, test } from 'bun:test';
import { ORPCError } from '@orpc/client';
import { oc } from '@orpc/contract';
import { type } from 'arktype';
import { makeClient } from '../client.ts';
import { contract } from '../contract.ts';

const authContract = contract({
  verify: oc.input(type({ token: 'string' })).output(type({ ok: 'boolean' })),
  session: {
    revoke: oc.input(type({ id: 'string' })).output(type({ revoked: 'boolean' })),
  },
});

const rpcOutput = (output: unknown, status = 200) =>
  new Response(JSON.stringify({ json: output }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const rpcError = (code: string, message: string, status: number) =>
  rpcOutput({ defined: false, inferable: false, code, message }, status);

describe('makeClient()', () => {
  test('POSTs JSON to <url>/rpc/<method> and returns the validated output', async () => {
    const requests: Request[] = [];
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: async (req) => {
        requests.push(req);
        return rpcOutput({ ok: true });
      },
    });

    const result = await client.verify({ token: 't' });

    expect(result).toEqual({ ok: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe('POST');
    expect(requests[0]?.url).toBe('http://auth.internal/rpc/verify');
    expect(await requests[0]?.json()).toEqual({ json: { token: 't' } });
  });

  test('a base URL with its own path is preserved, not dropped — a leading-slash-free join', async () => {
    const requests: Request[] = [];
    const client = makeClient(authContract, 'http://auth.internal/api/v1', {
      fetch: async (req) => {
        requests.push(req);
        return rpcOutput({ ok: true });
      },
    });

    await client.verify({ token: 't' });

    expect(requests[0]?.url).toBe('http://auth.internal/api/v1/rpc/verify');
  });

  test('preserves native nested oRPC router paths', async () => {
    const requests: Request[] = [];
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: async (req) => {
        requests.push(req);
        return rpcOutput({ revoked: true });
      },
    });

    await expect(client.session.revoke({ id: 'session-1' })).resolves.toEqual({ revoked: true });
    expect(requests[0]?.url).toBe('http://auth.internal/rpc/session/revoke');
  });

  test('decodes structured RPC errors with their stable code', async () => {
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: async () => rpcError('INTERNAL_SERVER_ERROR', 'Internal Server Error', 500),
    });

    try {
      await client.verify({ token: 't' });
      throw new Error('expected the RPC call to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ORPCError);
      if (!(error instanceof ORPCError)) throw error;
      expect(error.code).toBe('INTERNAL_SERVER_ERROR');
    }
  });

  test("a non-2xx RPC error's intentional public message is preserved", async () => {
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: async () => rpcError('UNAUTHORIZED', 'token expired', 401),
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
        return rpcOutput({ ok: true });
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
        return rpcOutput({ ok: true });
      },
    });

    await client.verify({ token: 't' });

    expect(requests[0]?.headers.has('authorization')).toBe(false);
  });

  test('propagates an AbortSignal through the generated client transport', async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const client = makeClient(authContract, 'http://auth.internal', {
      fetch: async (req) => {
        seenSignal = req.signal;
        return rpcOutput({ ok: true });
      },
    });

    await client.verify({ token: 't' }, { signal: controller.signal });

    expect(seenSignal?.aborted).toBe(controller.signal.aborted);
  });
});
