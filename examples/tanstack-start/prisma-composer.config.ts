import { defineConfig } from '@prisma/composer/config';
import { tanstackStartBuild } from '@prisma/composer/tanstack-start/control';
import { prismaCloud, prismaState } from '@prisma/composer-prisma-cloud/control';

export default defineConfig({
  extensions: [prismaCloud(), tanstackStartBuild()],
  state: () => prismaState(),
});
