import { compute } from '@prisma/app-cloud';
import { triggerContract } from '@prisma/app-cron';
import node from '@prisma/app-node';
import { rpc } from '@prisma/app-rpc';
import { workerContract } from '../worker/contract.ts';

export default compute({
  name: 'router',
  deps: { worker: rpc(workerContract) },
  build: node({ module: import.meta.url, entry: '../../dist/router/router-entry.mjs' }),
  expose: { trigger: triggerContract },
});
