/**
 * The integration app's control-plane config (ADR-0017): REAL /control
 * imports — `@prisma/app-cloud/control` and `@prisma/app-node/control`
 * resolve from this package's own dependency tree, exactly like an end
 * user's app. `prisma-app deploy` discovers this file by walking up from the
 * fixture entry (test/fixtures/extension-config/service.ts).
 */
import { defineConfig } from '@prisma/app/config';
import { prismaCloud, prismaState } from '@prisma/app-cloud/control';
import { nodeBuild } from '@prisma/app-node/control';

export default defineConfig({
  extensions: [prismaCloud(), nodeBuild()],
  state: () => prismaState(),
});
