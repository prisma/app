import { service, system } from '../../index.ts';

// Importing this module must not increment this counter — only Loading the
// system may run the body (the service node itself carries no handler to run).
export let bodyCallCount = 0;

const svc = service({
  name: 'test-service',
  pack: 'test/pack',
  type: 'fixture/app',
  inputs: {},
  params: {},
  build: {
    kind: 'node',
    pack: '@prisma/app-node',
    module: 'file:///test/service.ts',
    entry: 'server.js',
  },
});

export default system('fixture-system', (h) => {
  bodyCallCount += 1;
  h.provision('app', svc);
});
