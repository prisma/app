/**
 * Marks a service as deploying pre-built output. `node({ module, entry, dir? })`:
 * `entry` is your built entry point and `dir` is the compiled-output directory
 * shipped as the deploy bundle — both resolved relative to `dirname(module)`
 * (ADR-0004). `dir` defaults to the entry's own directory; a Next.js app passes
 * its standalone root explicitly (its `entry` nests below the hoisted
 * node_modules). `module` is the authoring module's `import.meta.url`. Returns
 * plain data — nothing runs on import. `extension` + `type` are the
 * control-plane registry key: deploy tooling routes assembly through the app's
 * `prisma-compose.config.ts` to this package's `/control` descriptor (ADR-0017).
 */
import type { BuildAdapter } from '@internal/core';

const nodeBuild = (opts: { module: string; entry: string; dir?: string }): BuildAdapter => ({
  extension: '@prisma/compose/node',
  type: 'node',
  module: opts.module,
  entry: opts.entry,
  ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
});

export default nodeBuild;
