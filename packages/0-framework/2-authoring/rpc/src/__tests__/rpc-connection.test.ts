import { describe, expect, test } from 'bun:test';
import { isNode, string } from '@internal/core';
import { type } from 'arktype';
import { contract } from '../contract.ts';
import { rpc } from '../rpc.ts';

const authContract = contract({
  verify: rpc({ input: type({ token: 'string' }), output: type({ ok: 'boolean' }) }),
});

describe('rpc(contract) — the dependency end', () => {
  test('returns a branded dependency end declaring the same { url: string } param as http()', () => {
    const end = rpc(authContract);

    expect(isNode(end)).toBe(true);
    expect(end.kind).toBe('dependency');
    expect(end.type).toBe('rpc');
    expect(end.connection.params).toEqual({
      url: string(),
      serviceKey: string({ optional: true, autoProvision: 'per-binding-key' }),
    });
  });

  test('serviceKey is optional', () => {
    const end = rpc(authContract);

    expect(end.connection.params['serviceKey']?.optional).toBe(true);
  });

  test('serviceKey carries the per-binding-key auto-provision facet (ADR-0030)', () => {
    const end = rpc(authContract);

    expect(end.connection.params['serviceKey']?.autoProvision).toBe('per-binding-key');
  });

  test('hydrate synchronously binds a client with a callable method per contract method', () => {
    const end = rpc(authContract);

    const client = end.connection.hydrate({ url: 'http://auth.internal' });

    expect(client).not.toBeInstanceOf(Promise);
    expect(typeof (client as { verify?: unknown }).verify).toBe('function');
  });
});
