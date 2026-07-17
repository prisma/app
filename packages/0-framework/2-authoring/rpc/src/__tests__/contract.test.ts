import { describe, expect, test } from 'bun:test';
import { blindCast } from '@internal/foundation/casts';
import { oc } from '@orpc/contract';
import { getHiddenRouterContract, implement } from '@orpc/server';
import { type } from 'arktype';
import { contract } from '../contract.ts';

describe('contract()', () => {
  test('brands and retains the exact native oRPC router', () => {
    const router = {
      verify: oc.input(type({ token: 'string' })).output(type({ ok: 'boolean' })),
    };

    const authContract = contract(router);

    expect(authContract.kind).toBe('rpc');
    expect(authContract.router).toBe(router);
    expect(
      blindCast<
        unknown,
        '__cmp has a deliberately erased runtime representation; this asserts it retains the router identity'
      >(authContract.__cmp),
    ).toBe(router);
  });

  test('the retained router works directly with native oRPC implement()', () => {
    const authContract = contract({
      verify: oc.input(type({ token: 'string' })).output(type({ ok: 'boolean' })),
    });
    const os = implement(authContract.router);
    const router = os.router({
      verify: os.verify.handler(({ input }) => ({ ok: input.token.length > 0 })),
    });

    expect(getHiddenRouterContract(router)).toBe(authContract.router);
  });

  test('satisfies() is nominal — a contract only satisfies itself', () => {
    const build = () =>
      contract({
        verify: oc.input(type({ token: 'string' })).output(type({ ok: 'boolean' })),
      });
    const authContract = build();
    const structurallyEqual = build();

    expect(authContract.satisfies(authContract)).toBe(true);
    expect(authContract.satisfies(structurallyEqual)).toBe(false);
  });

  test('the returned contract is frozen', () => {
    const authContract = contract({
      verify: oc.input(type({ token: 'string' })).output(type({ ok: 'boolean' })),
    });

    expect(Object.isFrozen(authContract)).toBe(true);
  });
});
