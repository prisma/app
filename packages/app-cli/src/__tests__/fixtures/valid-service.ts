import { service } from '@prisma/app';

export default service({
  name: 'fixture-service',
  pack: 'test/pack',
  type: 'fixture/service',
  inputs: {},
  params: {},
  build: { kind: 'node', pack: '@prisma/app-node', module: import.meta.url, entry: 'server.js' },
});
