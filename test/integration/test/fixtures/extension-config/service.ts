import { system } from '@prisma/app';
import { compute } from '@prisma/app-cloud';
import node from '@prisma/app-node';

/**
 * A real (not faked) service: `@prisma/integration-tests` genuinely depends
 * on `@prisma/app-node` and `@prisma/app-cloud`, and this package's own
 * `prisma-app.config.ts` (found by the CLI's walk-up from this entry)
 * imports both packages' REAL `/control` entries, so `prisma-app deploy`
 * resolves them from this app's own dependency tree — see
 * `../../cli.extension-config.test.ts`. The deploy root must be a system.
 */
export default system('extension-config-fixture', {}, ({ provision }) => {
  provision(
    compute({
      name: 'extension-config-fixture',
      deps: {},
      build: node({ module: import.meta.url, entry: 'dist/server.js' }),
    }),
    { id: 'extension-config-fixture' },
  );
  return {};
});
