import node from '@prisma/composer/node';
import { rpc } from '@prisma/composer/rpc';
import { compute } from '@prisma/composer-prisma-cloud';
import { calculatorContract } from './contract.ts';

export default compute({
  name: 'app',
  deps: { calculator: rpc(calculatorContract) },
  build: node({ module: import.meta.url, entry: '../dist/app/index.mjs' }),
});
