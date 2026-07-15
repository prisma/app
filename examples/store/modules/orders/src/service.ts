import node from '@prisma/composer/node';
import { rpc } from '@prisma/composer/rpc';
import { compute } from '@prisma/composer-prisma-cloud';
import { pnPostgres } from '@prisma/composer-prisma-cloud/prisma-next';
import { catalogContract } from '@store/catalog/contract';
import { ordersContract } from './contract.ts';
import { ordersData } from './data.ts';

// Two dependencies, two kinds: `db` hydrates to the Prisma Next typed client
// (ADR-0022); `catalog` hydrates to a typed client of another module's rpc
// contract.
export default compute({
  name: 'orders',
  deps: {
    db: pnPostgres(ordersData),
    catalog: rpc(catalogContract),
  },
  build: node({ module: import.meta.url, entry: '../dist/server.mjs' }),
  expose: { rpc: ordersContract },
});
