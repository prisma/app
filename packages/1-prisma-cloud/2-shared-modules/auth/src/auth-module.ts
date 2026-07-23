/**
 * The `auth()` module (spec § Module factory): a dedicated service wrapping
 * Better Auth. The database and the email sender are BOUNDARY dependencies —
 * the root decides dedicated vs shared for the database and wires the email
 * module's `send` port; the instance secret is the service's ordinary secret
 * slot, bound to `mintedSecret()` here so it is platform-minted and invisible
 * to consumers. `baseUrl` is the PUBLIC origin of the consumer app
 * (scheme+host, no trailing slash, no path); roots bind it
 * `envParam('AUTH_BASE_URL')`.
 */
import type { ModuleNode, ParamNeed } from '@internal/core';
import { module, paramNeed } from '@internal/core';
import { emailSender } from '@internal/email';
import { mintedSecret } from '@internal/prisma-cloud';
import { authService } from './auth-service.ts';
import { authAdminContract, authApiContract, authDb, authSessionContract } from './contract.ts';
import { type AuthTemplates, authTemplates } from './templates.ts';

export function auth(opts?: { name?: string }): ModuleNode<
  { db: ReturnType<typeof authDb>; email: ReturnType<typeof emailSender<AuthTemplates>> },
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
      deps: { db: authDb(), email: emailSender(authTemplates) },
      params: { baseUrl: paramNeed() },
      expose: {
        api: authApiContract,
        session: authSessionContract,
        admin: authAdminContract,
      },
    },
    ({ inputs, params, provision }) => {
      const service = provision(authService(), {
        id: 'service',
        deps: { db: inputs.db, email: inputs.email },
        secrets: { secret: mintedSecret() },
        params: { baseUrl: params.baseUrl },
      });
      return { api: service.api, session: service.session, admin: service.admin };
    },
  );
}
