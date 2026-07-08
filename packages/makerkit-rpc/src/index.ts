/**
 * The RPC kind: `contract()` + `rpc()` build a Contract whose Cmp is a
 * concrete function map, and `Client<C>` is the typed client a consumer's
 * dependency hydrates to. No transport yet — `serve()` and the client/network
 * binding are a later unit.
 */
export { contract } from './contract.ts';
export type { Client } from './rpc.ts';
export { rpc } from './rpc.ts';
