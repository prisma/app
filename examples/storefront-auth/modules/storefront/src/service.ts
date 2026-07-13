import node from '@prisma/compose/node';
import { rpc } from '@prisma/compose/rpc';
import { compute } from '@prisma/compose-prisma-cloud';
import { authContract } from '@storefront-auth/auth/contract';

export default compute({
  name: 'storefront',
  deps: { auth: rpc(authContract) },
  // `dir` is our Next standalone root (the build runs `prisma-compose
  // next-standalone` to copy the client assets in); `entry` is server.js's path
  // inside it, deep because outputFileTracingRoot is the repo root.
  build: node({
    module: import.meta.url,
    dir: '../.next/standalone',
    entry: '../.next/standalone/examples/storefront-auth/modules/storefront/server.js',
  }),
});
