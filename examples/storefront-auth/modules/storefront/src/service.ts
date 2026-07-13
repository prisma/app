import nextjs from '@prisma/compose/nextjs';
import { rpc } from '@prisma/compose/rpc';
import { compute } from '@prisma/compose-prisma-cloud';
import { authContract } from '@storefront-auth/auth/contract';

export default compute({
  name: 'storefront',
  deps: { auth: rpc(authContract) },
  // `standalone` is our finished flat standalone root (our build copies static
  // in — see scripts/flatten-standalone.mjs); `entry` is server.js's path
  // inside it, deep because outputFileTracingRoot is the repo root.
  build: nextjs({
    module: import.meta.url,
    standalone: '../.next/standalone',
    entry: 'examples/storefront-auth/modules/storefront/server.js',
  }),
});
