import nextjs from '@prisma/app-nextjs';
import { compute } from '@prisma/app-cloud';
import { rpc } from '@prisma/app-rpc';
import { authContract } from '@storefront-auth/auth/contract';

export default compute({
  name: 'storefront',
  deps: { auth: rpc(authContract) },
  build: nextjs({ module: import.meta.url, appDir: '..', entry: 'server.js' }),
});
