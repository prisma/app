import type { Contract, DependencyEnd, ResourceNode } from '@internal/core';
import { dependency, resource, string } from '@internal/core';

export interface AuthSecretConfig {
  readonly value: string;
}

/**
 * The contract the `auth-secret` resource provides — a minted per-instance
 * secret. `satisfies` compares KIND only (mirrors `credentialsContract`);
 * `__cmp` is the config the resource offers, which core never inspects.
 */
export const authSecretContract: Contract<'auth-secret', AuthSecretConfig> = Object.freeze({
  kind: 'auth-secret',
  __cmp: { value: '' },
  satisfies: (required: Contract<'auth-secret', unknown>) => required.kind === 'auth-secret',
});

export type AuthSecretContract = typeof authSecretContract;

/**
 * The one auth-secret factory; the argument shape picks the role. `{ name }` is
 * the resource identity a module provisions — the ONE place the secret is
 * minted (its lowering mints once and keeps it stable across deploys).
 */
export function authSecret(opts: { name: string }): ResourceNode<typeof authSecretContract>;
/**
 * `authSecret()` — a service's dependency on the minted secret. Its binding is
 * the typed `AuthSecretConfig`. The auth service reads the secret through this
 * dependency binding (no bespoke env reads).
 */
export function authSecret(): DependencyEnd<AuthSecretConfig, typeof authSecretContract>;
export function authSecret(opts?: {
  name: string;
}):
  | ResourceNode<typeof authSecretContract>
  | DependencyEnd<AuthSecretConfig, typeof authSecretContract> {
  if (opts?.name !== undefined) {
    return resource({
      name: opts.name,
      extension: '@prisma/composer-prisma-cloud',
      provides: authSecretContract,
    });
  }
  return dependency({
    type: 'auth-secret',
    connection: {
      params: {
        value: string(),
      },
      hydrate: (v): AuthSecretConfig => v,
    },
    required: authSecretContract,
  });
}
