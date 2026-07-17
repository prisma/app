import tanstackStart from '@prisma/composer/tanstack-start';
import { compute } from '@prisma/composer-prisma-cloud';

export default compute({
  name: 'web',
  deps: {},
  build: tanstackStart({
    module: import.meta.url,
    appDir: '..',
  }),
});
