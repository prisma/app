import node from '@prisma/compose/node';
import { compute, postgres } from '@prisma/compose-prisma-cloud';
import { catalogContract } from './contract.ts';

// The `db` dependency is pure requirement: its binding is PostgresConfig
// (`{ url }`), and the app builds its own SQL client from it in server.ts
// (ADR-0015).
export default compute({
  name: 'catalog',
  deps: {
    db: postgres(),
  },
  build: node({ module: import.meta.url, entry: '../dist/server.mjs' }),
  expose: { rpc: catalogContract },
});
