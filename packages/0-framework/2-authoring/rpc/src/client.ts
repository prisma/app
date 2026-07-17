/**
 * Composer's oRPC client transport adapter. Composer supplies the provider URL
 * and per-edge service key; the returned client is oRPC's native inferred
 * client for the contract router.
 */

import { blindCast } from '@internal/foundation/casts';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { AnyRpcContract } from './contract.ts';
import type { Client } from './rpc.ts';

/**
 * A fetch-shaped transport. Defaults to real `fetch`; a Composer `serve()`
 * handler can be supplied directly for in-process tests.
 */
export type Transport = (req: Request) => Promise<Response>;

function baseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function makeClient<C extends AnyRpcContract>(
  contract: C,
  url: string,
  opts?: { fetch?: Transport; serviceKey?: string },
): Client<C> {
  const transport = opts?.fetch;
  const link = new RPCLink({
    origin: baseUrl(url),
    url: '/rpc',
    headers: opts?.serviceKey === undefined ? {} : { authorization: `Bearer ${opts.serviceKey}` },
    ...(transport === undefined
      ? {}
      : {
          fetch: (requestUrl: string, init: RequestInit) =>
            transport(new Request(requestUrl, init)),
        }),
  });

  // The contract is intentionally a type-and-topology input here. Native oRPC
  // performs input/output validation on the provider router and transports the
  // already-transformed result with its RPC codec.
  void contract;
  return blindCast<
    Client<C>,
    'createORPCClient dynamically proxies the exact native router carried by C'
  >(createORPCClient(link));
}
