import type { DependencyEnd, ModuleNode, ResourceNode, ServiceNode } from './node.ts';

/** Path-derived: root-scope children are bare ids ("auth", "db"); a nested module's own children dot-join under its address ("auth.db"). */
export type NodeId = string;

export interface GraphNode {
  readonly id: NodeId;
  readonly node: ServiceNode | ResourceNode | DependencyEnd | ModuleNode;
}

/**
 * `input`: a service consumes its own declared dependency slot — from the
 * slot node to the service. `dependency`: a service consumes a provisioned
 * producer (a service or a resource — the one wiring mechanism) — from the
 * producer to the consumer, labeled with the consumer's input name (from the
 * module wiring).
 */
export interface Edge {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly input: string;
  readonly kind: 'input' | 'dependency';
}

/**
 * A resolved secret binding: the root bound a service's secret slot to a
 * platform env-var NAME, and the wiring forwarded it to that service's address
 * (ADR-0029). The framework carries only the name — the value is provisioned
 * out-of-band. A target's serializer keys the pointer row off this; the
 * preflight manifest aggregates the names.
 */
export interface SecretBinding {
  /** The graph address of the service that declares the secret slot. */
  readonly serviceAddress: NodeId;
  /** The secret slot key on that service. */
  readonly slot: string;
  /** The platform env-var name the root bound the slot to. */
  readonly name: string;
}

export interface Graph {
  readonly root: GraphNode;
  /** Root + one per input, topo-ordered (deps first). */
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly Edge[];
  /** Every service secret slot resolved to its root-bound platform name. */
  readonly secrets: readonly SecretBinding[];
}

/** Thrown by Load when the graph is malformed. */
export class LoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoadError';
  }
}
