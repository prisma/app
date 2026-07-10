// Bundle probe for the import-split guard: uses BOTH authoring entries (core
// and pack) the way a user service module would, with real value usage so
// nothing tree-shakes away.
import { configOf, hex, Load } from '@makerkit/core';
import { compute, postgres } from '@makerkit/prisma-cloud';

const app = compute({
  name: 'test-service',
  deps: {
    db: postgres({
      client: ({ url }) => ({ url }),
    }),
  },
  build: {
    kind: 'node',
    pack: '@makerkit/node',
    module: 'file:///test/service.ts',
    entry: 'server.js',
  },
});

export const graph = Load(
  hex('probe-hex', (h) => {
    const db = h.provision('db', postgres({ name: 'db' }));
    h.provision('app', app, { db });
  }),
  { id: 'probe' },
);

export const manifest = configOf(app);
