import { module } from '@prisma/composer';
import { envParam } from '@prisma/composer-prisma-cloud';
import { auth } from '@prisma/composer-prisma-cloud/auth';
import { pnPostgres } from '@prisma/composer-prisma-cloud/prisma-next';
import apiService from './src/api/service.ts';
import { appContract } from './src/contract.ts';
import opsService from './src/ops/service.ts';

/**
 * The auth example: a dedicated Prisma Next database carrying ONLY the auth
 * extension pack (empty app space), the `auth()` module wired to it, and two
 * consumer services proving least-privilege wiring:
 *
 *   - `api` — the app origin: proxies `/api/auth/*` to the auth service,
 *     JWT-verifies `/me`, and answers session lookups. Holds the `api` +
 *     `session` ports and the verifier; CANNOT touch admin ops.
 *   - `ops` — the back office: holds ONLY the `admin` port.
 *
 * `baseUrl` is the PUBLIC origin browsers would see (the api service).
 * A closed root: no boundary argument, no return — it only provisions.
 */
export default module('auth-example', ({ provision }) => {
  const db = provision(
    pnPostgres({ name: 'database', contract: appContract, config: './prisma-next.config.ts' }),
    { id: 'database' },
  );
  const identity = provision(auth(), {
    id: 'auth',
    deps: { db },
    params: { baseUrl: envParam('AUTH_BASE_URL') },
  });
  provision(apiService, {
    id: 'api',
    deps: { authApi: identity.api, verifier: identity.api, session: identity.session },
  });
  provision(opsService, { id: 'ops', deps: { admin: identity.admin } });
});
