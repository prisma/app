import { service, system } from '../../index.ts';

// Importing this module must not increment this counter — only Loading the
// system may run the body (the service node itself carries no handler to run).
export let bodyCallCount = 0;

const svc = service({
  name: 'test-service',
  extension: 'test/pack',
  type: 'fixture/app',
  inputs: {},
  params: {},
  build: {
    extension: '@prisma/app-node',
    type: 'node',
    module: 'file:///test/service.ts',
    entry: 'server.js',
  },
});

export default system('fixture-system', {}, ({ provision }) => {
  bodyCallCount += 1;
  provision('app', svc);
  return {};
});
