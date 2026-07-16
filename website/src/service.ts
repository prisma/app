import node from '@prisma/composer/node';
import { compute } from '@prisma/composer-prisma-cloud';

/**
 * The docs site: a single Bun HTTP service with no dependencies. The guides
 * are baked into the bundle at build time (src/generated/content.ts), so it
 * provisions nothing and serves everything from memory.
 */
export default compute({
  name: 'site',
  deps: {},
  build: node({ module: import.meta.url, entry: '../dist/server.mjs' }),
});
