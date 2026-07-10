import type { Contract } from '@makerkit/core';
import { resource } from '@makerkit/core';

const fixtureContract: Contract<'fixture/resource', Record<string, never>> = Object.freeze({
  kind: 'fixture/resource',
  __cmp: {},
  satisfies: (required: Contract<'fixture/resource', unknown>) =>
    required.kind === 'fixture/resource',
});

export default resource({
  name: 'fixture-resource',
  pack: 'test/pack',
  provides: fixtureContract,
});
