/**
 * Marks a service as a plain server for deployment. `node({ module, entry })`
 * says the app's built server lives at `entry`, resolved relative to
 * `dirname(module)` — exactly like an import specifier (ADR-0004). `module`
 * is the authoring module's `import.meta.url`. Returns plain data — nothing
 * runs on import. `assembler` is this pack's own `/assemble` module —
 * baked in here so `ServiceNode.loadAssembler()`/`assemble()` can import it
 * directly at deploy time (node-owned loads; no framework-constructed
 * specifier).
 */
import type { BuildAdapter } from '@prisma/app';

const ASSEMBLER = '@prisma/app-node/assemble';

export default (opts: { module: string; entry: string }): BuildAdapter => ({
  kind: 'node',
  assembler: ASSEMBLER,
  module: opts.module,
  entry: opts.entry,
});
