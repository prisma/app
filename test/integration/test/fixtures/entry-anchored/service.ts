import { system } from '@prisma/app';
import { compute } from '@prisma/app-cloud';
import node from '@prisma/app-node';

/**
 * A real (not faked) service: `@prisma/integration-tests` genuinely
 * depends on `@prisma/app-node` and `@prisma/app-cloud`, so `prisma-app
 * deploy` resolves both packs' `/target` and `/assemble` entries for real,
 * anchored at this fixture's entry package (test/integration itself) — see
 * `../cli.entry-anchored-resolution.test.ts`. The deploy root must be a system.
 */
export default system('entry-anchored-fixture', (h) => {
  h.provision(
    'entry-anchored-fixture',
    compute({
      name: 'entry-anchored-fixture',
      deps: {},
      build: node({ module: import.meta.url, entry: 'dist/server.js' }),
    }),
  );
});
