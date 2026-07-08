import { fileURLToPath } from 'node:url';
import { lower } from '@makerkit/core/deploy';
import { prismaCloud } from '@makerkit/prisma-cloud/target';
import service from './src/service.ts';

/**
 * Deploy script (heavy imports; never bundled): lowers the authored service
 * onto Prisma Cloud — one Project (poisoned DATABASE_URL/_POOLED, a real
 * named Database for `db`), one Compute service, one Deployment. Interim
 * hand-written stack until `makerkit deploy` (a declarative
 * makerkit.config.ts) lands — see core-model.md's Extension points.
 *
 *   pnpm build     # bundles src/server.ts + src/service.ts to dist/bundle
 *   pnpm deploy    # builds, sources ../../.env, runs `alchemy deploy`
 *
 * Requires env (repo-root .env, see `pnpm setup:env`):
 * PRISMA_SERVICE_TOKEN, PRISMA_WORKSPACE_ID, ALCHEMY_PASSWORD.
 */
const workspaceId = process.env['PRISMA_WORKSPACE_ID'];
if (!workspaceId) throw new Error('PRISMA_WORKSPACE_ID is required');

export default lower(service, prismaCloud({ workspaceId }), {
  name: 'makerkit-hello',
  bundle: {
    dir: fileURLToPath(new URL('./dist/bundle', import.meta.url)),
    entry: 'server.js',
  },
});
