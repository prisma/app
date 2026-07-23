/**
 * `composeServiceFetch` — the one fetch topology a service's entrypoint and
 * its local test server share: health probe, optional public prefix, rpc
 * dispatch, 404 for the rest. /health answers before anything else, and the
 * public prefix is matched before /rpc/*, so a prefix that would swallow rpc
 * requests is rejected when the handler is composed rather than at runtime.
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

  test('a public prefix that would swallow /rpc/ is rejected at composition time', () => {
    for (const pathPrefix of ['/', '', '/r', '/rp', '/rpc', '/rpc/', '/rpc/getUser']) {
      expect(() =>
        composeServiceFetch({
          rpcHandler: tag('rpc'),
          publicHandler: { pathPrefix, handler: tag('public') },
        }),
      ).toThrow(`the public path prefix "${pathPrefix}" overlaps the rpc route "/rpc/"`);
    }
  });

  test('a public prefix that cannot reach an rpc path is accepted', () => {
    for (const pathPrefix of ['/api/auth', '/rpx', '/public/rpc/']) {
      expect(() =>
        composeServiceFetch({
          rpcHandler: tag('rpc'),
          publicHandler: { pathPrefix, handler: tag('public') },
        }),
      ).not.toThrow();
    }
  });
});
