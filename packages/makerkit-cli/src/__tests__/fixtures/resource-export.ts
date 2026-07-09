import { resource } from '@makerkit/core';

export default resource({
  name: 'fixture-resource',
  pack: 'test/pack',
  type: 'fixture/resource',
  connection: {
    params: {},
    hydrate: () => ({}),
  },
});
