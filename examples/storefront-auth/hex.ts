import { hex } from '@makerkit/core';
import { postgres } from '@makerkit/prisma-cloud';
import authService from '@storefront-auth/auth';
import storefrontService from '@storefront-auth/storefront';

/**
 * The storefront-auth app: two services and their shared Postgres in one hex.
 * The hex owns `db` and wires it into auth's `db` slot; `auth` exposes an RPC
 * contract; `storefront` consumes it (auth's `rpc` port → storefront's `auth`
 * slot, compat-checked). Transparent wiring, executed at Load.
 */
export default hex('storefront-auth', (h) => {
  const db = h.provision('db', postgres({ name: 'db' }));
  const authRef = h.provision('auth', authService, { db });
  h.provision('storefront', storefrontService, { auth: authRef.rpc });
});
