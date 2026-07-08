import { describe, expect, test } from 'bun:test';
import type { Contract } from '../contract.ts';
import { provision } from '../contract.ts';

const fakeContract = <Cmp>(cmp: Cmp, ok: boolean): Contract<string, Cmp> => ({
  kind: 'fake',
  __cmp: cmp,
  satisfies: () => ok,
});

describe('provision()', () => {
  test('accepts wiring whose contracts satisfy every required dep', () => {
    const required = fakeContract({}, true);
    const provided = fakeContract({}, true);

    expect(() => provision('s1', { deps: { auth: required } }, { auth: provided })).not.toThrow();
  });

  test('throws naming the id and the dep when a wired contract fails satisfies()', () => {
    const required = fakeContract({}, true);
    const provided = fakeContract({}, false);

    expect(() => provision('s1', { deps: { auth: required } }, { auth: provided })).toThrow(
      /provision\("s1"\): "auth" does not satisfy/,
    );
  });

  test('checks every dep, not just the first', () => {
    const ok = fakeContract({}, true);
    const bad = fakeContract({}, false);

    expect(() =>
      provision('s1', { deps: { a: ok, b: ok, c: ok } }, { a: ok, b: bad, c: ok }),
    ).toThrow(/"b" does not satisfy/);
  });
});
