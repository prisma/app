/**
 * The orders Module: owns its own Postgres, but NOT the catalog — that comes
 * in through the module's boundary (`deps.catalog`), wired by whoever
 * provisions this module. The consumer supplies any producer of
 * `catalogContract`; orders never knows which.
 */
import { module } from '@prisma/compose';
import { rpc } from '@prisma/compose/rpc';
import { postgres } from '@prisma/compose-prisma-cloud';
import { catalogContract } from '@store/catalog/contract';
import { ordersContract } from './contract.ts';
import ordersService from './service.ts';

export default module(
  'orders',
  { deps: { catalog: rpc(catalogContract) }, expose: { rpc: ordersContract } },
  ({ inputs, provision }) => {
    const db = provision(postgres({ name: 'database' }));
    const service = provision(ordersService, {
      id: 'service',
      deps: { db, catalog: inputs.catalog },
    });
    return { rpc: service.rpc };
  },
);
