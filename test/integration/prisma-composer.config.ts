/**
 * The integration app's control-plane config (ADR-0017): REAL /control
 * imports — `@prisma/composer-prisma-cloud/control` and `@prisma/composer/node/control`
 * resolve from this package's own dependency tree, exactly like an end
 * user's app. `prisma-composer deploy` discovers this file by walking up from the
 * fixture entry (test/fixtures/extension-config/service.ts).
 */
import { defineConfig } from '@prisma/composer/config';
import { nodeBuild } from '@prisma/composer/node/control';
import { prismaCloud, prismaState } from '@prisma/composer-prisma-cloud/control';

export default defineConfig({
  extensions: [prismaCloud(), nodeBuild()],
  state: prismaState(),
});
