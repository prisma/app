import nextjs from '@prisma/composer/nextjs';
import { rpc } from '@prisma/composer/rpc';
import { compute } from '@prisma/composer-prisma-cloud';
import { authContract } from '@storefront-auth/auth/contract';

export default compute({
  name: 'storefront',
  deps: { auth: rpc(authContract) },
  // `appDir` is the Next app root; `next build` (output: standalone) is all the
  // app does — deploy assembly copies the standalone tree and the static/public
  // assets Next omits, and locates server.js itself.
  build: nextjs({ module: import.meta.url, appDir: '..' }),
});
