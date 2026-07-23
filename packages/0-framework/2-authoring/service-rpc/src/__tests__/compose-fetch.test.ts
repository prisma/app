/**
 * `composeServiceFetch` — the one fetch topology a service's entrypoint and
 * its local test server share: health probe, optional public prefix, rpc
 * dispatch, 404 for the rest. Routing order matters: the public prefix wins
 * over /rpc/* only when they overlap by construction (they don't here), and
 * /health answers before anything else.
 */
import { describe, expect, test } from 'bun:test';
import { composeServiceFetch } from '../compose-fetch.ts';

const tag =
  (name: string) =>
  async (_request: Request): Promise<Response> =>
    new Response(name, { status: 200 });

const request = (path: string) => new Request(`http://svc.local${path}`);

describe('composeServiceFetch', () => {
  test('/health answers 200 {"ok":true} with a JSON content type', async () => {
    const fetchHandler = composeServiceFetch({ rpcHandler: tag('rpc') });
    const res = await fetchHandler(request('/health'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({ ok: true });
  });

  test('/rpc/* routes to the rpc handler', async () => {
    const fetchHandler = composeServiceFetch({ rpcHandler: tag('rpc') });
    const res = await fetchHandler(request('/rpc/getUser'));
    expect(await res.text()).toBe('rpc');
  });

  test('the public prefix routes everything under it to the public handler', async () => {
    const fetchHandler = composeServiceFetch({
      rpcHandler: tag('rpc'),
      publicHandler: { pathPrefix: '/api/auth', handler: tag('public') },
    });
    expect(await (await fetchHandler(request('/api/auth/sign-in/email'))).text()).toBe('public');
    expect(await (await fetchHandler(request('/api/auth'))).text()).toBe('public');
    // rpc still dispatches beside it.
    expect(await (await fetchHandler(request('/rpc/getUser'))).text()).toBe('rpc');
  });

  test('anything else is a 404; without a public handler, its prefix 404s too', async () => {
    const fetchHandler = composeServiceFetch({ rpcHandler: tag('rpc') });
    expect((await fetchHandler(request('/'))).status).toBe(404);
    expect((await fetchHandler(request('/api/auth/session'))).status).toBe(404);
    // /rpc without the trailing segment separator is not an rpc route.
    expect((await fetchHandler(request('/rpc'))).status).toBe(404);
  });
});
