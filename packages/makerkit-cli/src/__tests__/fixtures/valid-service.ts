import { service } from '@makerkit/core';

export default service({
  name: 'fixture-service',
  pack: 'test/pack',
  type: 'fixture/service',
  inputs: {},
  params: {},
  build: { kind: 'node', pack: '@makerkit/node', module: import.meta.url, entry: 'server.js' },
});
