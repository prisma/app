import { prismaTsDownConfig } from '@prisma/composer/tsdown';

// The site is a self-contained Bun server (ADR-0005): the rendered docs are
// baked into src/generated/content.ts at build time, so the runtime bundle
// carries no markdown/highlighter dependency — only the entry's own code.
export default prismaTsDownConfig({
  entry: { server: 'src/server.ts' },
  outDir: 'dist',
});
