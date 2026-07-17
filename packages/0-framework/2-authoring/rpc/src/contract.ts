/**
 * Composer's topology wrapper around a native oRPC contract router.
 *
 * oRPC owns procedure schemas, typed errors, metadata, nesting, and client
 * inference. Composer adds only the Contract shape core needs to compare and
 * wire a provider port to a consumer dependency.
 */
import type { Contract } from '@internal/core';
import { blindCast } from '@internal/foundation/casts';
import type { RouterContract, RouterContractClient } from '@orpc/contract';

/** A method-bearing native oRPC contract router accepted by Composer. */
export type RpcRouterContract = Readonly<Record<string, RouterContract>>;

/** A Composer RPC contract retaining its native oRPC router unchanged. */
export type RpcContract<R extends RpcRouterContract = RpcRouterContract> = Contract<
  'rpc',
  RouterContractClient<R>
> & {
  /** The native router passed to oRPC's `implement()` and ecosystem tooling. */
  readonly router: R;
};

/** Erased RPC contract bound used where the concrete native router is unknown. */
export type AnyRpcContract = Contract<'rpc', unknown> & {
  readonly router: RpcRouterContract;
};

/** Extracts the native oRPC router from a Composer RPC contract. */
export type RouterOf<C> = C extends RpcContract<infer R> ? R : never;

export function isRpcContract(value: unknown): value is AnyRpcContract {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'rpc' &&
    '__cmp' in value &&
    'satisfies' in value &&
    'router' in value &&
    typeof value.router === 'object' &&
    value.router !== null
  );
}

/**
 * Makes a native oRPC contract router available to Composer's topology.
 * Procedure authoring remains the standard `oc.input(...).output(...)` API.
 */
export function contract<R extends RpcRouterContract>(router: R): RpcContract<R> {
  let value: RpcContract<R>;
  value = {
    kind: 'rpc',
    // Core never reads __cmp at runtime. Its concrete native client shape makes
    // TypeScript apply method width plus input/output variance at wiring sites.
    __cmp: blindCast<
      RouterContractClient<R>,
      'RouterContractClient<R> is the client createORPCClient produces for this exact native router'
    >(router),
    router,
    satisfies: (required) => value === required,
  };
  return Object.freeze(value);
}
