/**
 * Native oRPC contract authoring and implementation, wrapped by Composer's
 * topology, hydration, and service-to-service authorization. All transport
 * code is Web-standard (fetch/Request/Response).
 */

export type { ORPCErrorCode as RpcErrorCode } from '@orpc/client';
export { ORPCError as RpcError } from '@orpc/client';
export type { RouterContract, RouterContractClient } from '@orpc/contract';
export { oc } from '@orpc/contract';
export type { ContractedRouter } from '@orpc/server';
export { implement } from '@orpc/server';
export type { Transport } from './client.ts';
export { makeClient } from './client.ts';
export type { RouterOf, RpcContract, RpcRouterContract } from './contract.ts';
export { contract } from './contract.ts';
export type { Client } from './rpc.ts';
export { perBindingToken, RPC_PEER_KEY, rpc } from './rpc.ts';
export type { Routers, ServeOptions } from './serve.ts';
export { DEFAULT_RPC_MAX_BODY_SIZE, RPC_ACCEPTED_KEYS_ENV, serve } from './serve.ts';
