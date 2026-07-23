/**
 * The `auth-secret` mint, proven WITHOUT Alchemy: its provider `reconcile`
 * mints a fresh secret on first create (no prior `output`) and returns the
 * persisted secret UNCHANGED on every later apply — the no-op-redeploy
 * property the auth module relies on (rotation would invalidate sessions).
 * Driven directly against the exported provider service (the
 * s3-credentials.test.ts pattern), plus the dual-form authoring factory's
 * node shapes.
 */
import { describe, expect, test } from 'bun:test';
import type { DependencyEnd, ResourceNode } from '@internal/core';
import * as Effect from 'effect/Effect';
import { type AuthSecretConfig, authSecret, authSecretContract } from '../auth-secret.ts';
import {
  type AuthSecretAttributes,
  authSecretProviderService,
  mintAuthSecret,
} from '../auth-secret-resource.ts';

const reconcile = (output: AuthSecretAttributes | undefined) =>
  authSecretProviderService.reconcile({
    id: 'secret',
    instanceId: 'secret',
    news: {},
    olds: output === undefined ? undefined : {},
    output,
    session: undefined as never,
    bindings: undefined as never,
  });

describe('AuthSecret mint provider', () => {
  test('first create mints a fresh 32-byte base64 secret', async () => {
    const minted = await Effect.runPromise(reconcile(undefined));
    // 32 bytes base64-encode to 44 chars (43 + one '=' pad).
    expect(minted.value).toHaveLength(44);
    expect(atob(minted.value)).toHaveLength(32);
  });

  test('a redeploy returns the persisted secret unchanged (idempotent no-op)', async () => {
    const first = await Effect.runPromise(reconcile(undefined));
    const second = await Effect.runPromise(reconcile(first));
    expect(second).toEqual(first);
  });

  test('two independent mints differ (the secret is random, not derived)', () => {
    expect(mintAuthSecret()).not.toEqual(mintAuthSecret());
  });
});

describe('authSecret() authoring factory', () => {
  test('{ name } yields a resource providing authSecretContract', () => {
    const identity: ResourceNode<typeof authSecretContract> = authSecret({ name: 'secret' });
    expect(identity.kind).toBe('resource');
    expect(identity.type).toBe('auth-secret');
    expect(identity.provides).toBe(authSecretContract);
  });

  test('authSecret() yields a dependency requiring authSecretContract, binding the secret', () => {
    const dep: DependencyEnd<AuthSecretConfig, typeof authSecretContract> = authSecret();
    expect(dep.kind).toBe('dependency');
    expect(dep.type).toBe('auth-secret');
    expect(dep.required).toBe(authSecretContract);
    expect(dep.connection.params['value']).toBeDefined();
  });

  test('authSecretContract.satisfies compares kind only', () => {
    expect(
      authSecretContract.satisfies({
        kind: 'auth-secret',
        __cmp: undefined,
        satisfies: () => true,
      }),
    ).toBe(true);
  });
});
