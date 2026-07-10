import { hex } from '@prisma/app';
import { postgres } from '@prisma/app-cloud';
import authService from '@storefront-auth/auth';
import storefrontService from '@storefront-auth/storefront';

/**
 * The storefront-auth app: two services and their shared Postgres in one hex.
 * The hex owns the database and wires it into auth's `db` slot; `auth` exposes
 * an RPC contract; `storefront` consumes it (auth's `rpc` port → storefront's
 * `auth` slot, compat-checked). Transparent wiring, executed at Load.
 *
 * The provision id is `database`, not `db`: the prisma-cloud target passes it
 * through as the Prisma resource name, and the Connection API rejects names
 * shorter than 3 characters. The wiring key stays `db` (auth's input name), so
 * the deployed env key is still `AUTH_DB_URL` — it derives from the input
 * name, not the provision id.
 *
 * A closed root: empty boundary (no inputs, no outputs) — nothing wires into
 * or out of this hex from the outside.
 */
export default hex('storefront-auth', {}, ({ provision }) => {
  const db = provision('database', postgres({ name: 'database' }));
  const authRef = provision('auth', authService, { db });
  provision('storefront', storefrontService, { auth: authRef.rpc });
  return {};
});
