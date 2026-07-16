import { string } from '@prisma/composer';
import node from '@prisma/composer/node';
import { compute } from '@prisma/composer-prisma-cloud';

/**
 * A single compute service with one required param and no default — the
 * smallest surface that forces a provision-time binding. The root binds
 * `greeting` to a platform env var via `envParam` (module.ts); the server
 * reads it back through `config()`.
 */
export default compute({
  name: 'echo',
  deps: {},
  params: { greeting: string() },
  build: node({ module: import.meta.url, entry: '../dist/server.mjs' }),
});
