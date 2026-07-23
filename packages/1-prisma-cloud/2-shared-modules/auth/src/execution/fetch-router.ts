/**
 * The service's fetch composition (spec § Entrypoint, exact routing) — one
 * function so the deployed entrypoint and `startLocalAuthServer` serve the
 * SAME topology:
 *
 *   /health       → 200 {"ok":true}   (no auth — platform probe)
 *   /api/auth*    → Better Auth        (public, D10 — login can't demand a bearer)
 *   /rpc/*        → serve()'s handler  (ADR-0030 bearer-checked inside)
 *   otherwise     → 404
 */

export interface AuthFetchParts {
  /** Better Auth's own handler (`auth.handler`). */
  readonly authHandler: (request: Request) => Promise<Response>;
  /** serve()'s generated rpc handler for the session + admin ports. */
  readonly rpcHandler: (request: Request) => Promise<Response>;
}

export function composeAuthFetch(parts: AuthFetchParts): (request: Request) => Promise<Response> {
  return async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === '/health') {
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pathname.startsWith('/api/auth')) return parts.authHandler(request);
    if (pathname.startsWith('/rpc/')) return parts.rpcHandler(request);
    return new Response('Not found', { status: 404 });
  };
}
