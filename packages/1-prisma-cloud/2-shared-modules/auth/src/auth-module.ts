/**
 * The `auth()` module (spec § Module factory, S1 shape — the `email`
 * boundary dep arrives with slice S2): a dedicated service wrapping Better
 * Auth. The database is a BOUNDARY dependency — the root decides dedicated
 * vs shared (D2); the instance secret is provisioned inside, platform-minted
 * and invisible to consumers (D8). `baseUrl` is the PUBLIC origin of the
 * consumer app (scheme+host, no trailing slash, no path); roots bind it
 * `envParam('AUTH_BASE_URL')`.
 */
import type { ModuleNode, ParamNeed } from '@internal/core';
import { module, paramNeed } from '@internal/core';
import { authSecret } from '@internal/prisma-cloud';
import { authService } from './auth-service.ts';
import { authAdminContract, authApiContract, authDb, authSessionContract } from './contract.ts';

export function auth(opts?: { name?: string }): ModuleNode<
  { db: ReturnType<typeof authDb> },
  {
    api: typeof authApiContract;
    session: typeof authSessionContract;
    admin: typeof authAdminContract;
  },
  Record<never, never>,
  { baseUrl: ParamNeed }
> {
  return module(
    opts?.name ?? 'auth',
    {
      deps: { db: authDb() },
      params: { baseUrl: paramNeed() },
      expose: {
        api: authApiContract,
        session: authSessionContract,
        admin: authAdminContract,
      },
    },
    ({ inputs, params, provision }) => {
      const secret = provision(authSecret({ name: 'secret' }), { id: 'secret' });
      const service = provision(authService(), {
        id: 'service',
        deps: { db: inputs.db, secret },
        params: { baseUrl: params.baseUrl },
      });
      return { api: service.api, session: service.session, admin: service.admin };
    },
  );
}
