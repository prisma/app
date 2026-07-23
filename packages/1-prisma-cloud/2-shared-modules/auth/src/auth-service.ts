/**
 * The auth compute service (spec § Service): the pack-carrying `db`
 * dependency, the `email` boundary dependency (real verification, reset and
 * magic-link delivery), the platform-minted instance `secret` slot, the
 * public `baseUrl` param (the consumer app's origin — what browsers see and
 * `trustedOrigins` allows), and the three exposed ports backed by one
 * process. Build/entry mechanics copied from email's service file:
 * `build.module` points at this file's own built output so the deploy
 * bootstrap can re-import it as `main`; `entry` resolves the sibling
 * entrypoint pass in the same dist directory.
 */
import { param, secret } from '@internal/core';
import { emailSender } from '@internal/email';
import node from '@internal/node';
import { compute } from '@internal/prisma-cloud';
import { type } from 'arktype';
import { authAdminContract, authApiContract, authDb, authSessionContract } from './contract.ts';
import { authTemplates } from './templates.ts';

export function authService() {
  return compute({
    name: 'auth',
    deps: { db: authDb(), email: emailSender(authTemplates) },
    // An ORDINARY secret slot: `auth()` binds it to `mintedSecret()`, so the
    // platform mints a stable value at deploy and nobody ever supplies one.
    secrets: { secret: secret() },
    // No `port` param here: `port` is compute()'s RESERVED service param
    // (declaring one fails at authoring) — the entrypoint reads it from
    // `config()` like every other service.
    params: {
      baseUrl: param(type('string'), {}),
    },
    expose: { api: authApiContract, session: authSessionContract, admin: authAdminContract },
    build: node({
      module: new URL('./auth-service.mjs', import.meta.url).href,
      entry: './auth-entrypoint.mjs',
    }),
  });
}

export default authService();
