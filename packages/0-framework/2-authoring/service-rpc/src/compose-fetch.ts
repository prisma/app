/**
 * Composes a service's whole fetch surface from its parts — one function so a
 * deployed entrypoint and a local test server serve the SAME topology:
 *
 *   /health         → 200 {"ok":true}     (no auth — platform probe)
 *   <publicPrefix>* → the public handler   (optional; public by definition)
 *   /rpc/*          → serve()'s handler    (service-key-checked inside serve)
 *   otherwise       → 404
 *
 * Deliberately minimal: one public prefix, fixed routing order. Everything
 * runs on ONE port — first-class multi-port routing is a separate concern
 * this helper does not attempt.
 *
 * Not on the published API: this is shared between first-party packages
 * through the `@internal/service-rpc/compose-fetch` subpath only.
 */

const RPC_ROUTE = '/rpc/';

export interface ServiceFetchParts {
  /** serve()'s generated handler for the service's rpc ports. */
  readonly rpcHandler: (request: Request) => Promise<Response>;
  /** An optional public (non-rpc) surface, mounted under its path prefix — e.g. Better Auth's handler under `/api/auth`. */
  readonly publicHandler?: {
    readonly pathPrefix: string;
    readonly handler: (request: Request) => Promise<Response>;
  };
}

export function composeServiceFetch(
  parts: ServiceFetchParts,
): (request: Request) => Promise<Response> {
  const pub = parts.publicHandler;
  if (pub !== undefined && overlapsRpcRoute(pub.pathPrefix)) {
    throw new Error(
      `composeServiceFetch: the public path prefix "${pub.pathPrefix}" overlaps the rpc route "${RPC_ROUTE}". ` +
        'The public handler is matched first, so every rpc request would reach it instead of the ' +
        'service-key-checked rpc handler. Choose a prefix that neither contains nor sits under ' +
        `"${RPC_ROUTE}".`,
    );
  }
  return async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === '/health') {
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (pub !== undefined && pathname.startsWith(pub.pathPrefix)) return pub.handler(request);
    if (pathname.startsWith(RPC_ROUTE)) return parts.rpcHandler(request);
    return new Response('Not found', { status: 404 });
  };
}

function overlapsRpcRoute(pathPrefix: string): boolean {
  return RPC_ROUTE.startsWith(pathPrefix) || pathPrefix.startsWith(RPC_ROUTE);
}
