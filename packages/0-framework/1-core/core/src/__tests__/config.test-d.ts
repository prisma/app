/**
 * Type-level facet rules for config params (ADR-0029): `secret` and `default`
 * are mutually exclusive, and `envSecret` infers a string ConfigParam.
 * Type-only (vitest `--typecheck`, never executed).
 */
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { expectTypeOf, test } from 'vitest';
import type { ConfigParam } from '../config.ts';
import { envSecret, param, string } from '../config.ts';

test('envSecret infers ConfigParam<StandardSchemaV1<string, string>>', () => {
  expectTypeOf(envSecret('STRIPE_KEY')).toEqualTypeOf<
    ConfigParam<StandardSchemaV1<string, string>>
  >();
  expectTypeOf(envSecret('STRIPE_KEY', { optional: true })).toEqualTypeOf<
    ConfigParam<StandardSchemaV1<string, string>>
  >();
});

test('a non-secret param may carry a default; a secret one may still be optional', () => {
  string({ default: 'x' });
  string({ optional: true, default: 'x' });
  string({ secret: true });
  string({ secret: true, optional: true });
});

test('a secret param may not carry a default', () => {
  // @ts-expect-error secret forbids default
  string({ secret: true, default: 'x' });
});

test('a secret param over an arbitrary schema may not carry a default either', () => {
  const schema = {} as StandardSchemaV1<string, string>;
  // @ts-expect-error secret forbids default
  param(schema, { secret: true, default: 'x' });
});
