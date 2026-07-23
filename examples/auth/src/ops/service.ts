/** The ops service: the back office — holds ONLY the auth module's admin port. */
import node from '@prisma/composer/node';
import { rpc } from '@prisma/composer/service-rpc';
import { compute } from '@prisma/composer-prisma-cloud';
import { authAdminContract } from '@prisma/composer-prisma-cloud/auth';

export default compute({
  name: 'ops',
  deps: { admin: rpc(authAdminContract) },
  build: node({ module: import.meta.url, entry: '../../dist/ops/server.mjs' }),
});
