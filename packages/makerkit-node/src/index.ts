/**
 * Marks a service as a plain server for deployment. `node({ module, entry })`
 * says the app's built server lives at `entry`, resolved relative to
 * `dirname(module)` — exactly like an import specifier (ADR-0004). `module`
 * is the authoring module's `import.meta.url`. Returns plain data — nothing
 * runs on import.
 */
import type { BuildAdapter } from '@makerkit/core';

export default (opts: { module: string; entry: string }): BuildAdapter => ({
  kind: 'node',
  pack: '@makerkit/node',
  module: opts.module,
  entry: opts.entry,
});
