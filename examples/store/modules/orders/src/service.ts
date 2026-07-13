import node from '@prisma/compose/node';
import { rpc } from '@prisma/compose/rpc';
import { compute, postgres } from '@prisma/compose-prisma-cloud';
import { catalogContract } from '@store/catalog/contract';
import { ordersContract } from './contract.ts';

// Two dependencies, two kinds: `db` binds to PostgresConfig (the app builds
// its own client, ADR-0015); `catalog` hydrates to a typed client of another
// module's contract.
export default compute({
  name: 'orders',
  deps: {
    db: postgres(),
    catalog: rpc(catalogContract),
  },
  build: node({ module: import.meta.url, entry: '../dist/server.mjs' }),
  expose: { rpc: ordersContract },
});
