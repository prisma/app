/**
 * The catalog Module: a reusable unit that owns its own Postgres. It
 * provisions the database and the catalog compute service, wires the db into
 * the service's `db` input, and exposes the service's `rpc` port as the
 * Module's own output. A consumer wires only the exposed contract — it never
 * sees the database.
 *
 * The database provision id is "database" (the Connection API rejects names
 * shorter than 3 characters); the service keeps an explicit "service" id so
 * it doesn't read as "catalog.catalog".
 */
import { module } from '@prisma/compose';
import { postgres } from '@prisma/compose-prisma-cloud';
import { catalogContract } from './contract.ts';
import catalogService from './service.ts';

export default module('catalog', { expose: { rpc: catalogContract } }, ({ provision }) => {
  const db = provision(postgres({ name: 'database' }));
  const service = provision(catalogService, { id: 'service', deps: { db } });
  return { rpc: service.rpc };
});
