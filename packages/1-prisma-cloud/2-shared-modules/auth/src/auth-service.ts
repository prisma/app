/**
 * The auth compute service (spec § Service): the pack-carrying `db`
 * dependency, the platform-minted instance `secret`, the public `baseUrl`
 * param (the consumer app's origin — what browsers see and `trustedOrigins`
 * allows), and the three exposed ports backed by one process. Build/entry
 * mechanics copied from email's service file: `build.module` points at this
 * file's own built output so the deploy bootstrap can re-import it as `main`;
 * `entry` resolves the sibling entrypoint pass in the same dist directory
 * (lands in D5 — the paths are data until then).
 */
import { param } from '@internal/core';
import node from '@internal/node';
import { authSecret, compute } from '@internal/prisma-cloud';
import { type } from 'arktype';
import { authAdminContract, authApiContract, authDb, authSessionContract } from './contract.ts';

export function authService() {
  return compute({
    name: 'auth',
    deps: { db: authDb(), secret: authSecret() },
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
