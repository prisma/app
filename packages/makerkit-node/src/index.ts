/**
 * The `node` build adapter — descriptor only (the ecosystem-seam authoring
 * side). A self-served service (Hono, plain HTTP) whose runnable the app builds
 * itself; `entry` is that runnable, service-dir-relative. The heavy assembler
 * (deploy machine) is future work — until the makerkit-deploy CLI, the example
 * build produces the bundle dir. Imports only @makerkit/core's type; lean by
 * invariant (nothing runs on import).
 */
import type { BuildAdapter } from '@makerkit/core';

export default (opts: { entry: string }): BuildAdapter => ({ kind: 'node', entry: opts.entry });
