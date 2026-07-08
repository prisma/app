/**
 * The `nextjs` build adapter — descriptor only (the ecosystem-seam authoring
 * side). A framework-hosted service: Next builds the standalone server, and its
 * pages pull typed deps via `service.load()`. `entry` is the standalone
 * runnable, service-dir-relative. The heavy assembler (Next standalone fixups)
 * is future work — until the makerkit-deploy CLI, the example build produces the
 * bundle dir. Imports only @makerkit/core's type; lean by invariant.
 */
import type { BuildAdapter } from '@makerkit/core';

export default (opts: { entry: string }): BuildAdapter => ({ kind: 'nextjs', entry: opts.entry });
