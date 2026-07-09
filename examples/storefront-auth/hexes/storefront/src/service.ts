import nextjs from '@makerkit/nextjs';
import { compute } from '@makerkit/prisma-cloud';
import { rpc } from '@makerkit/rpc';
import { authContract } from '@storefront-auth/auth/contract';

export default compute({
  name: 'storefront',
  deps: { auth: rpc(authContract) },
  build: nextjs({ module: import.meta.url, appDir: '..', entry: 'server.js' }),
});
