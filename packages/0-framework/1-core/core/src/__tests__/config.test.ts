import { describe, expect, test } from 'bun:test';
import { configOf, envSecret, number, param, string } from '../config.ts';
import { dependency, service } from '../node.ts';
import { conn, scalarDeclaration } from './helpers.ts';

const build = {
  extension: '@prisma/compose/node',
  type: 'node',
  module: 'file:///test/service.ts',
  entry: 'server.js',
};

describe('configOf', () => {
  test('enumerates input params then service params — semantic, no platform keys', () => {
    const root = service({
      name: 'test-service',
      extension: 'test/pack',
      type: 'fake/app',
      inputs: {
        db: dependency({
          name: 'db',
          type: 'fake/db',
          connection: conn(
            { url: string({ secret: true }), schema: string({ optional: true }) },
            () => ({}),
          ),
        }),
      },
      params: { port: number({ default: 3000 }) },
      build,
    });

    expect(configOf(root)).toEqual([
      scalarDeclaration({ input: 'db' }, 'url', { secret: true }),
      scalarDeclaration({ input: 'db' }, 'schema', { optional: true }),
      scalarDeclaration('service', 'port', { default: 3000 }),
    ]);
  });

  test('owner discriminates service vs input params — same name cannot collide', () => {
    const root = service({
      name: 'test-service',
      extension: 'test/pack',
      type: 'fake/app',
      inputs: {
        cache: dependency({
          name: 'cache',
          type: 'fake/cache',
          connection: conn({ port: number() }, () => ({})),
        }),
      },
      params: { port: number({ default: 3000 }) },
      build,
    });

    const owners = configOf(root).map((e) => ({ owner: e.owner, name: e.name }));
    expect(owners).toEqual([
      { owner: { input: 'cache' }, name: 'port' },
      { owner: 'service', name: 'port' },
    ]);
  });

  test('a dep-less service enumerates only its own params', () => {
    const root = service({
      name: 'test-service',
      extension: 'test/pack',
      type: 'fake/app',
      inputs: {},
      params: { port: number({ default: 3000 }) },
      build,
    });

    expect(configOf(root)).toEqual([scalarDeclaration('service', 'port', { default: 3000 })]);
  });

  test('executes nothing — configOf never calls a connection hydrate', () => {
    let hydrateCalls = 0;
    const root = service({
      name: 'test-service',
      extension: 'test/pack',
      type: 'fake/app',
      inputs: {
        db: dependency({
          name: 'db',
          type: 'fake/db',
          connection: conn({ url: string() }, () => {
            hydrateCalls += 1;
            return {};
          }),
        }),
      },
      params: {},
      build,
    });

    configOf(root);

    expect(hydrateCalls).toBe(0);
  });
});

describe('configOf over dependency inputs', () => {
  test('every dependency input appears with owner { input }, whatever it will be wired to', () => {
    const root = service({
      name: 'test-service',
      extension: 'test/pack',
      type: 'fake/app',
      inputs: {
        db: dependency({
          name: 'db',
          type: 'fake/db',
          connection: conn({ url: string({ secret: true }) }, () => ({})),
        }),
        auth: dependency({
          type: 'fake/http',
          connection: conn({ url: string() }, () => ({})),
        }),
      },
      params: { port: number({ default: 3000 }) },
      build,
    });

    expect(configOf(root)).toEqual([
      scalarDeclaration({ input: 'db' }, 'url', { secret: true }),
      scalarDeclaration({ input: 'auth' }, 'url'),
      scalarDeclaration('service', 'port', { default: 3000 }),
    ]);
  });
});

describe('envSecret', () => {
  test('binds a secret string param to a platform env-var name — no default', () => {
    const p = envSecret('STRIPE_SECRET_KEY');
    expect(p.secret).toBe(true);
    expect(p.external).toBe('STRIPE_SECRET_KEY');
    expect(p.optional).toBeUndefined();
    expect(p.default).toBeUndefined();
    // Reuses the shared string schema — same singleton string() carries.
    expect(p.schema).toBe(string().schema);
  });

  test('carries optional when asked, still no default', () => {
    const p = envSecret('SENDGRID_API_KEY', { optional: true });
    expect(p.secret).toBe(true);
    expect(p.optional).toBe(true);
    expect(p.external).toBe('SENDGRID_API_KEY');
    expect(p.default).toBeUndefined();
  });

  test('rejects an empty name at construction', () => {
    expect(() => envSecret('')).toThrow(/non-empty platform env-var name/);
  });

  test('rejects the reserved COMPOSE_ prefix', () => {
    expect(() => envSecret('COMPOSE_STRIPE')).toThrow(/COMPOSE_/);
  });

  test('rejects the poisoned DATABASE_URL keys', () => {
    expect(() => envSecret('DATABASE_URL')).toThrow(/reserved/);
    expect(() => envSecret('DATABASE_URL_POOLED')).toThrow(/reserved/);
  });
});

describe('secret forbids default (runtime guard)', () => {
  test('string({ secret: true, default }) throws', () => {
    expect(() => string({ secret: true, default: 'x' } as never)).toThrow(
      /secret config param cannot declare a `default`/,
    );
  });

  test('param(schema, { secret: true, default }) throws', () => {
    expect(() => param(string().schema, { secret: true, default: 'x' } as never)).toThrow(
      /secret config param cannot declare a `default`/,
    );
  });

  test('a non-secret param keeps its default', () => {
    expect(string({ default: 'x' }).default).toBe('x');
  });
});

describe('configOf reports external', () => {
  test('a service-own secret param reports its platform name; a non-secret one reports undefined', () => {
    const root = service({
      name: 'ingest',
      extension: 'test/pack',
      type: 'fake/app',
      inputs: {},
      params: { stripeKey: envSecret('STRIPE_SECRET_KEY'), port: number({ default: 3000 }) },
      build,
    });

    expect(configOf(root)).toEqual([
      scalarDeclaration('service', 'stripeKey', {
        secret: true,
        external: 'STRIPE_SECRET_KEY',
      }),
      scalarDeclaration('service', 'port', { default: 3000 }),
    ]);
  });

  test('a dependency-input secret connection param reports external when bound', () => {
    const root = service({
      name: 'ingest',
      extension: 'test/pack',
      type: 'fake/app',
      inputs: {
        billing: dependency({
          name: 'billing',
          type: 'fake/rpc',
          connection: conn({ key: envSecret('BILLING_KEY') }, () => ({})),
        }),
      },
      params: {},
      build,
    });

    expect(configOf(root)).toEqual([
      scalarDeclaration({ input: 'billing' }, 'key', {
        secret: true,
        external: 'BILLING_KEY',
      }),
    ]);
  });
});
