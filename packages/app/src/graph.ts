import { type Graph, LoadError, type NodeId } from './graph-types.ts';
import { loadService } from './load-service.ts';
import { loadSystem } from './load-system.ts';
import { isNode, type ServiceNode, type SystemNode } from './node.ts';

export type { Edge, Graph, GraphNode, NodeId } from './graph-types.ts';
export { LoadError } from './graph-types.ts';

/**
 * Builds the in-memory graph from a root node. A service root walks its own
 * `inputs`; a system root executes its body (wiring, not user code — the
 * designed exception to imports-run-nothing) and recursively flattens every
 * system it provisions into one graph of hierarchical addresses. A malformed
 * graph is a `LoadError` that names its fix; the individual validation rules
 * live with `loadService` / `loadSystem` and are covered by name in the Load
 * tests. Executes nothing of the user's own code beyond system bodies.
 */
export function Load(root: ServiceNode | SystemNode, opts?: { id?: NodeId }): Graph {
  // Brand-check the untrusted root once (a user default-export could be junk
  // TypeScript believes is a node), then route by its discriminant.
  if (!isNode(root)) {
    throw new LoadError(
      'Load expects a branded service or system node (construct it with the service()/system() factories).',
    );
  }
  if (root.kind === 'system') return loadSystem(root, opts);
  if (root.kind === 'service') return loadService(root, opts?.id ?? 'root');
  throw new LoadError('Load expects a service or system root (received another node kind).');
}
