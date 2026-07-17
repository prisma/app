/**
 * `rpc(contract)` declares a Composer dependency on a native oRPC contract.
 * Dependency hydration supplies oRPC's inferred client over the provider URL
 * and the per-binding Prisma service key.
 */
import type { Contract, ProvisionNeed } from '@internal/core';
import { type DependencyEnd, dependency, provisionNeed, string } from '@internal/core';
import { makeClient } from './client.ts';
import type { AnyRpcContract } from './contract.ts';
import { isRpcContract } from './contract.ts';

/** ADR-0031's need brand for RPC's per-binding service key. */
export const RPC_PEER_KEY: unique symbol = Symbol.for('prisma:rpc/per-binding-key');

/** The provisioning need `rpc()`'s `serviceKey` parameter declares. */
export const perBindingToken = (): ProvisionNeed => provisionNeed(RPC_PEER_KEY);

export function rpc<C extends AnyRpcContract>(contract: C): DependencyEnd<Client<C>, C> {
  if (!isRpcContract(contract)) {
    throw new TypeError(
      'rpc(): expected a Composer contract created with contract(nativeOrpcRouter).',
    );
  }

  return dependency({
    type: 'rpc',
    connection: {
      params: {
        url: string(),
        serviceKey: string({ optional: true, provision: perBindingToken() }),
      },
      hydrate: ({ url, serviceKey }) => makeClient(contract, url, { serviceKey }),
    },
    required: contract,
  });
}

/** The native oRPC client a consumer's `rpc(contract)` dependency hydrates to. */
export type Client<C> = C extends Contract<string, infer Cmp> ? Cmp : never;
