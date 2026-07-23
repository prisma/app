/**
 * The RPC kind: `contract()` + `rpc()` build a Contract whose Cmp is a
 * concrete function map; `rpc(contract)` (the connection-end overload)
 * hydrates a consumer's dependency to `Client<C>` over the network binding in
 * client.ts; `serve()` generates a provider's fetch handler straight off a
 * service's `expose`. All web-standard (fetch/Request/Response) — runs
 * anywhere those exist, no node/bun coupling.
 *
 * Every call carries an idempotency key and retries safely: the client
 * mints one per logical call and bounded-retries with it; the server
 * requires it and dedupes on it. A handler's optional third argument,
 * typed `RpcHandlerContext`, carries that key as `ctx.idempotencyKey`.
 */

export type { Transport } from '../client.ts';
export { makeClient } from '../client.ts';
export type { ServiceFetchParts } from '../compose-fetch.ts';
export { composeServiceFetch } from '../compose-fetch.ts';
export { contract } from '../contract.ts';
export type { Client } from '../rpc.ts';
export { isRpcContract, perBindingToken, RPC_PEER_KEY, rpc } from '../rpc.ts';
export type { Handlers, RpcHandlerContext } from '../serve.ts';
export { RPC_ACCEPTED_KEYS_ENV, serve } from '../serve.ts';
