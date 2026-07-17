import { prismaTsDownConfig } from '@prisma/composer/tsdown';

export default [
  prismaTsDownConfig({ entry: { calculator: 'src/calculator.ts' }, outDir: 'dist/calculator' }),
  prismaTsDownConfig({ entry: { index: 'src/index.ts' }, outDir: 'dist/app' }),
];
