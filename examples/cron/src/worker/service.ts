import node from '@prisma/composer/node';
import { compute } from '@prisma/composer-prisma-cloud';
import { workerContract } from './contract.ts';

export default compute({
  name: 'worker',
  deps: {},
  build: node({ module: import.meta.url, entry: '../../dist/worker/server.mjs' }),
  expose: { rpc: workerContract },
});
