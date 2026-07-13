import { module } from '@prisma/compose';
import { storage } from '@prisma/compose-prisma-cloud/storage';
import smokeService from './src/smoke/service.ts';

/**
 * The storage example deploy root: the `storage()` module (its own Postgres,
 * minted credentials, and the s3-store service) plus an in-deployment `smoke`
 * consumer whose `blob` slot is wired to the module's `store` port. The smoke
 * service reaches the store over its deployed HTTPS endpoint and runs the
 * aws-sdk op suite internally — the minted creds arrive via the binding and
 * never leave the deployment (design-notes decision 10).
 *
 * A closed root: no boundary argument, no return — it only provisions.
 */
export default module('storage-example', ({ provision }) => {
  const store = provision(storage());
  provision(smokeService, { deps: { blob: store.store } });
});
