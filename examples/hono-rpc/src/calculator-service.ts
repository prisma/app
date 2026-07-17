import node from '@prisma/composer/node';
import { compute } from '@prisma/composer-prisma-cloud';
import { calculatorContract } from './contract.ts';

export default compute({
  name: 'calculator',
  deps: {},
  build: node({ module: import.meta.url, entry: '../dist/calculator/calculator.mjs' }),
  expose: { rpc: calculatorContract },
});
