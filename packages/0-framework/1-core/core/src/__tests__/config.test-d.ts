/**
 * Type-level rules for the secret slot vocabulary (ADR-0029): `secret()` is a
 * need, `envSecret()` is a source, `SecretValues<S>` boxes each slot, and
 * `provision` requires a source per declared secret slot. Type-only (vitest
 * `--typecheck`, never executed).
 */
import type { SecretBox } from '@internal/foundation/secret';
import { expectTypeOf, test } from 'vitest';
import type { BuildAdapter, SecretNeed, SecretSource, SecretValues } from '../node.ts';
import { envSecret, module, secret, service } from '../node.ts';

const build: BuildAdapter = {
  extension: '@prisma/compose/node',
  type: 'node',
  module: 'file:///test/service.ts',
  entry: 'server.js',
};

test('secret() is a SecretNeed; envSecret() is a SecretSource', () => {
  expectTypeOf(secret()).toEqualTypeOf<SecretNeed>();
  expectTypeOf(envSecret('AUTH_SIGNING_KEY')).toEqualTypeOf<SecretSource>();
});

test('SecretValues<S> maps each declared slot to a SecretBox<string>', () => {
  type S = { signingKey: SecretNeed; apiKey: SecretNeed };
  expectTypeOf<SecretValues<S>>().toEqualTypeOf<{
    readonly signingKey: SecretBox<string>;
    readonly apiKey: SecretBox<string>;
  }>();
});

test('provisioning a service with a secret slot requires a source per slot', () => {
  const svc = service({
    name: 'auth',
    extension: 'test/pack',
    type: 'fake/app',
    inputs: {},
    params: {},
    secrets: { signingKey: secret() },
    build,
  });

  module('root', ({ provision }) => {
    // @ts-expect-error a declared secret slot must be bound
    provision(svc, { id: 'auth' });
    provision(svc, { id: 'auth', secrets: { signingKey: envSecret('AUTH_SIGNING_KEY') } });
  });
});
