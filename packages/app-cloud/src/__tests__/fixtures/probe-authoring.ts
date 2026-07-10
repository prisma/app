// Bundle probe for the import-split guard: uses BOTH authoring entries (core
// and pack) the way a user service module would, with real value usage so
// nothing tree-shakes away.
import { configOf, Load, system } from '@prisma/app';
import { compute, postgres } from '@prisma/app-cloud';

const app = compute({
  name: 'test-service',
  deps: {
    db: postgres({
      client: ({ url }) => ({ url }),
    }),
  },
  build: {
    kind: 'node',
    pack: '@prisma/app-node',
    module: 'file:///test/service.ts',
    entry: 'server.js',
  },
});

export const graph = Load(
  system('probe-system', (h) => {
    const db = h.provision('db', postgres({ name: 'db' }));
    h.provision('app', app, { db });
  }),
  { id: 'probe' },
);

export const manifest = configOf(app);
