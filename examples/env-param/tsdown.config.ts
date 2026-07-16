import { prismaTsDownConfig } from '@prisma/composer/tsdown';

// The app's own build (ADR-0005): one self-contained server bundle.
export default prismaTsDownConfig({ entry: { server: 'src/server.ts' }, outDir: 'dist' });
