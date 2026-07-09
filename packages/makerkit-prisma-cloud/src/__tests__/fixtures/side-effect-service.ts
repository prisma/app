import { compute, postgres } from '../../index.ts';

// Importing this module must not increment this counter — only load()
// hydrating the db input should.
export let clientCalls = 0;

export default compute({
  name: 'test-service',
  deps: {
    db: postgres({
      name: 'test-resource',
      client: ({ url }) => {
        clientCalls += 1;
        return { url };
      },
    }),
  },
  build: {
    kind: 'node',
    pack: '@makerkit/node',
    module: 'file:///test/service.ts',
    entry: 'server.js',
  },
});
