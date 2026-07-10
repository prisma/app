import { blindCast } from './casts.ts';
import {
  type DependencyEnd,
  type Deps,
  type HexBuilder,
  type HexContext,
  type HexNode,
  isNode,
  type ProvisionedRef,
  type ResourceNode,
  type ServiceNode,
} from './node.ts';

/** Path-derived: root-scope children are bare ids ("auth", "db"); a nested hex's own children dot-join under its address ("auth.db"). */
export type NodeId = string;

export interface GraphNode {
  readonly id: NodeId;
  readonly node: ServiceNode | ResourceNode | DependencyEnd | HexNode;
}

/**
 * `input`: a service consumes its own declared dependency slot — from the
 * slot node to the service. `dependency`: a service consumes a provisioned
 * producer (a service or a resource — the one wiring mechanism) — from the
 * producer to the consumer, labeled with the consumer's input name (from the
 * hex wiring).
 */
export interface Edge {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly input: string;
  readonly kind: 'input' | 'dependency';
}

export interface Graph {
  readonly root: GraphNode;
  /** Root + one per input, topo-ordered (deps first). */
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly Edge[];
}

/** Thrown by Load when the graph is malformed. */
export class LoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoadError';
  }
}

/**
 * Builds the in-memory graph. For a service root it walks `root.inputs`,
 * assigns ids, builds `input` edges. For a hex root it EXECUTES the body (the
 * body is wiring, not user code — running it at Load is the designed
 * exception to imports-run-nothing) with a `provision` closure, recursively
 * flattening any hex it provisions: a child hex's own body runs (once,
 * during this same Load), and its owned resources, services, and hexes join
 * the same graph under hierarchical addresses (parent address + "." + the
 * provision id — bare ids at the root, unchanged from before nesting
 * existed).
 *
 * Validation: every node branded with a non-empty type; every dependency
 * slot of anything provisioned — a service or a nested hex — wired to a
 * provisioned producer (dangling = LoadError); a wired ref whose slot
 * declares a required contract must satisfy() it (LoadError on mismatch —
 * TypeScript already rejects it at the wiring site, so reaching here means a
 * cast bypassed it); the dependency edges form a DAG (a cycle is a LoadError
 * with the cycle named) — forwarded inputs resolve to their real producer
 * before an edge is recorded, so this check sees through hex boundaries with
 * no special casing. Wiring correctness (producer known, satisfies,
 * dangling) is checked once the WHOLE graph has been walked — against the
 * one shared `byId`, so a nested hex may forward in a producer provisioned
 * by an ancestor scope, and a wiring value may also name a producer
 * provisioned later in the same scope. A hex's own boundary adds three more:
 * a declared input never forwarded into a provision (and not returned as an
 * expose output); a declared expose key missing from the body's return or
 * failing satisfies(); a hex with non-empty deps Loaded as root (no
 * enclosing scope to wire them). A service Loaded directly as the root (not
 * via a hex) may not carry any dependency slot — nothing at the root wires
 * or provisions for it — so that is a LoadError naming the input and
 * pointing at the composing hex instead (ADR-0003). Executes nothing of the
 * user's own code beyond hex bodies (which are wiring, not app logic).
 */
export function Load(root: ServiceNode | HexNode, opts?: { id?: NodeId }): Graph {
  // Brand-check the untrusted root once (a user default-export could be junk
  // TypeScript believes is a node), then route by its discriminant.
  if (!isNode(root)) {
    throw new LoadError(
      'Load expects a branded service or hex node (construct it with the service()/hex() factories).',
    );
  }
  if (root.kind === 'hex') return loadHex(root, opts);
  if (root.kind === 'service') return loadService(root, opts?.id ?? 'root');
  throw new LoadError('Load expects a service or hex root (received another node kind).');
}

function serviceInputs(
  service: ServiceNode,
  serviceId: NodeId,
): { nodes: GraphNode[]; edges: Edge[] } {
  if (typeof service.inputs !== 'object' || service.inputs === null) {
    throw new LoadError(`Service "${serviceId}" has no inputs map.`);
  }
  const nodes: GraphNode[] = [];
  const edges: Edge[] = [];
  for (const [input, value] of Object.entries(service.inputs)) {
    // `inputs` is untrusted at runtime (a user module could carry junk the
    // types don't see), so the kind is re-checked as a plain string.
    const kind: string | undefined = isNode(value) ? value.kind : undefined;
    if (kind === 'resource') {
      throw new LoadError(
        `Input "${input}" of "${serviceId}" is a resource node — a resource is provisioned by ` +
          'the composing hex, never created for a service that mentions it. Declare the input ' +
          "as a dependency (the pack's dependency factory) and wire the hex-provisioned " +
          "resource's ref into it.",
      );
    }
    if (kind !== 'dependency') {
      throw new LoadError(
        `Input "${input}" of "${serviceId}" is not a branded dependency end ` +
          '(construct it with the dependency() factory).',
      );
    }
    if (value.type.length === 0) {
      throw new LoadError(`Input "${input}" of "${serviceId}" has an empty node type.`);
    }
    const id = `${serviceId}.${input}`;
    nodes.push({ id, node: value });
    edges.push({ from: id, to: serviceId, input, kind: 'input' });
  }
  return { nodes, edges };
}

function loadService(root: ServiceNode, rootId: NodeId): Graph {
  for (const [input, value] of Object.entries(root.inputs)) {
    if (isNode(value) && value.kind === 'dependency') {
      throw new LoadError(
        `Service "${rootId}" has an unwired dependency input "${input}" — this service is composed ` +
          `by a hex; deploy the hex instead of loading "${rootId}" directly.`,
      );
    }
  }
  const rootGraphNode: GraphNode = { id: rootId, node: root };
  const { nodes, edges } = serviceInputs(root, rootId);
  return {
    root: rootGraphNode,
    nodes: [...topoSort(nodes, edges), rootGraphNode],
    edges,
  };
}

/**
 * Stable topological sort: every edge's `from` precedes its `to` in the
 * result. Ties (nodes with no ordering constraint between them) keep their
 * relative order from `nodes` — so a graph already authored producer-first
 * comes out byte-identical to its pre-sort layout; only a graph that
 * genuinely needs reordering (e.g. a hex wired via a forged ref pointing at a
 * not-yet-provisioned producer) actually moves. A Kahn's-algorithm variant
 * that always picks the ready node with the smallest original index. Edges
 * whose endpoint falls outside `nodes` (e.g. a service-root's input edges
 * targeting the root, which is appended separately) are ignored. Cycles
 * cannot reach here: `assertDependencyDag` already rejects them for
 * dependency edges, and input edges never cycle.
 */
function topoSort(nodes: readonly GraphNode[], edges: readonly Edge[]): GraphNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const indexOf = new Map(nodes.map((n, i) => [n.id, i]));
  const indegree = new Map<NodeId, number>(nodes.map((n) => [n.id, 0]));
  const successors = new Map<NodeId, NodeId[]>();

  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    const targets = successors.get(edge.from) ?? [];
    targets.push(edge.to);
    successors.set(edge.from, targets);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
  }

  const ready = new Set(nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id));
  const order: NodeId[] = [];

  while (ready.size > 0) {
    let next: NodeId | undefined;
    let bestIndex = Number.POSITIVE_INFINITY;
    for (const id of ready) {
      const index = indexOf.get(id) ?? Number.POSITIVE_INFINITY;
      if (index < bestIndex) {
        bestIndex = index;
        next = id;
      }
    }
    if (next === undefined) break;
    ready.delete(next);
    order.push(next);
    for (const target of successors.get(next) ?? []) {
      const remaining = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, remaining);
      if (remaining === 0) ready.add(target);
    }
  }

  // Kahn's leaves cyclic nodes unprocessed rather than looping. A cycle can't
  // reach here (assertDependencyDag runs first; input edges never cycle), but
  // if that guard were ever bypassed, dropping nodes silently would be far
  // worse than failing — so assert completeness.
  if (order.length !== nodes.length) {
    throw new LoadError(
      `topological sort processed ${order.length} of ${nodes.length} nodes — ` +
        'the graph contains a cycle that slipped past the DAG validation.',
    );
  }

  return order.map((id) => byId.get(id)).filter((n): n is GraphNode => n !== undefined);
}

/**
 * Builds the ref a provision() call hands back: the id (so a producer with no
 * exposed ports — or an untyped slot — can still be wired wholesale) plus one
 * ref-port per exposed contract, each the contract's own runtime value (so
 * its `satisfies()` still works) tagged with the provider's id.
 */
function refFor(id: string, service: ServiceNode): ProvisionedRef {
  const ports: Record<string, unknown> = {};
  for (const [port, contract] of Object.entries(service.expose ?? {})) {
    ports[port] = { ...contract, __providerId: id };
  }
  return blindCast<
    ProvisionedRef,
    'ref-ports are built from the service exposed contracts keyed by port name, matching ProvisionedRef mapped shape'
  >({ id, ...ports });
}

/**
 * The resource variant of refFor: a resource has exactly one port — the
 * contract it provides — flattened onto the ref itself, tagged with the
 * provider id. `id` is written last so a hostile contract value cannot
 * clobber it.
 */
function refForResource(id: string, resource: ResourceNode): ProvisionedRef {
  return blindCast<
    ProvisionedRef,
    'the ref is the provided contract value tagged with the provider id — the `{ id } & RefPort<C>` shape the resource provision() overload pins'
  >({ ...resource.provides, __providerId: id, id });
}

/** A wired value's producer id: a ref-port's `__providerId`, or a bare ref's `id`. */
function producerIdOf(ref: unknown): string | undefined {
  if (typeof ref !== 'object' || ref === null) return undefined;
  if ('__providerId' in ref && typeof ref.__providerId === 'string') return ref.__providerId;
  if ('id' in ref && typeof ref.id === 'string') return ref.id;
  return undefined;
}

/**
 * Brands each `ctx.inputs` entry with the input key it stands for (see
 * flatten): diagnostic only — usage attribution relies on the per-key object
 * identity the branding copy creates, never on reading this back.
 */
const HEX_INPUT_KEY = Symbol('makerkit:hex-input-key');

/** Whether `ref` carries a callable `satisfies` that accepts `required` truthily. */
function satisfiesRequired(ref: unknown, required: unknown): boolean {
  return (
    typeof ref === 'object' &&
    ref !== null &&
    'satisfies' in ref &&
    typeof ref.satisfies === 'function' &&
    ref.satisfies(required)
  );
}

/**
 * A `wiring` object recorded against the Deps of whatever it wired (a
 * service's `.inputs` or a hex's `.deps` — the same shape either way),
 * checked once the whole graph is known (see `validateWiring`). Recorded
 * immediately at provision() time so the same call order that already gives
 * the graph its topological order also gives this list its natural order;
 * validated later so a wiring value may legitimately name a producer this
 * same scope (or an ancestor scope, or — forwarded — a descendant scope)
 * provisions, resolved against the one `byId` shared across the entire
 * recursive flatten.
 */
interface PendingWiring {
  readonly deps: Deps;
  readonly wiring: Record<string, unknown>;
  readonly targetId: string;
  readonly targetKind: 'service' | 'hex';
  readonly enclosingHexName: string;
}

/**
 * Checks one recorded `wiring` object against the Deps it was wired against:
 * every named input exists and is a dependency slot, every referenced
 * producer is a real (by-now-provisioned) address, and a wired ref whose
 * slot declares a required contract must satisfy() it — no producer-kind
 * branching, the contract alone determines validity, whether the producer is
 * a service port or a resource. Shared by both provisioned kinds so a
 * hex-as-child gets exactly the checks a service gets, and run once per
 * entry against the one `byId` shared by the whole recursive flatten, so a
 * forwarded ref resolves through to its real producer address regardless of
 * which ancestor scope provisioned it.
 */
function validateWiring(
  pending: PendingWiring,
  byId: ReadonlyMap<string, ServiceNode | ResourceNode | HexNode>,
): void {
  const { deps, wiring, targetId, targetKind, enclosingHexName } = pending;

  for (const [input, ref] of Object.entries(wiring)) {
    // Cast to the slot's DEFAULT type arguments: the `any`-instantiated union
    // Deps carries trips a narrowing quirk (isNode's predicate drops
    // DependencyEnd<any, any> from the union entirely). The runtime check
    // below — the single `kind === 'dependency'` test — is unaffected by
    // what this cast claims.
    const declared = blindCast<
      DependencyEnd | undefined,
      "sidesteps the any-instantiated narrowing quirk; the runtime kind === 'dependency' check below is what actually validates it"
    >(deps[input]);
    if (declared === undefined || !isNode(declared) || declared.kind !== 'dependency') {
      throw new LoadError(
        `Wiring for "${targetId}" names "${input}", which is not a dependency slot of that ${targetKind}.`,
      );
    }

    const producerId = producerIdOf(ref);
    const producer = producerId !== undefined ? byId.get(producerId) : undefined;
    if (producerId === undefined || producer === undefined) {
      throw new LoadError(
        `Wiring for "${targetId}.${input}" references "${String(producerId)}", which is not ` +
          `provisioned in hex "${enclosingHexName}".`,
      );
    }

    const required = declared.required;
    if (required !== undefined && !satisfiesRequired(ref, required)) {
      throw new LoadError(
        `Wiring for "${targetId}.${input}" does not satisfy its required contract.`,
      );
    }
  }

  for (const [input, rawValue] of Object.entries(deps)) {
    const value = blindCast<
      DependencyEnd | undefined,
      'sidesteps the any-instantiated narrowing quirk (see above); the runtime kind check below validates it'
    >(rawValue);
    if (!isNode(value) || wiring[input] !== undefined) continue;
    if (value.kind === 'dependency') {
      throw new LoadError(
        `Dependency input "${input}" of provisioned ${targetKind} "${targetId}" is not wired to a ` +
          `producer (hex "${enclosingHexName}").`,
      );
    }
  }
}

/** The (unvalidated) edges a `wiring` object implies — one dependency edge per entry; `validateWiring` does the real checking. */
function wiringEdges(wiring: Record<string, unknown>, targetId: string): Edge[] {
  return Object.entries(wiring).map(([input, ref]) => ({
    from: producerIdOf(ref) ?? '',
    to: targetId,
    input,
    kind: 'dependency' as const,
  }));
}

/**
 * Recursively flattens one hex's body into the shared graph state and
 * returns its resolved HexOutputs (one ref-port per expose key) for the
 * caller (the enclosing provision() call, or Load itself for the root) to
 * use. `address` is this hex's OWN full address, or `undefined` for the root
 * scope — its direct children then get bare (unprefixed) addresses, keeping
 * a single-level hex identical to before nesting existed. `wiring` supplies a
 * resolved producer ref-port for each of this hex's OWN declared deps (empty
 * for the root, which may not declare any — see the root non-empty-deps
 * check in loadHex). `nodes`, `edges`, `pending`, and `byId` are shared
 * across the ENTIRE recursive flatten, not per scope — a nested hex may
 * forward in a producer provisioned by an ancestor scope, and it is the
 * shared `byId` (keyed by full address) that lets that resolve.
 */
function flatten(
  hexNode: HexNode,
  address: string | undefined,
  wiring: Record<string, unknown>,
  nodes: GraphNode[],
  edges: Edge[],
  pending: PendingWiring[],
  byId: Map<string, ServiceNode | ResourceNode | HexNode>,
): Record<string, unknown> {
  const localIds = new Set<string>();
  const used = new Set<string>();

  // Each ctx.inputs entry gets its OWN object identity: a shallow copy of the
  // wired producer ref, branded (symbol-keyed) with the input key it stands
  // for. Without the copy, wiring ONE producer ref into TWO inputs would
  // alias both entries to the same object, and forwarding one would falsely
  // count as forwarding the other. The copy reads through unchanged —
  // `__providerId`, `satisfies`, and edge construction all see the original
  // ref's own fields — so edges keep carrying the REAL producer address.
  const ctxInputs: Record<string, unknown> = {};
  for (const key of Object.keys(hexNode.deps)) {
    const wired = wiring[key];
    ctxInputs[key] =
      typeof wired === 'object' && wired !== null ? { ...wired, [HEX_INPUT_KEY]: key } : wired;
  }

  // An input counts as USED when its per-key ctx.inputs value shows up in a
  // provision's wiring (forwarded down) — or, below, in the body's returned
  // outputs (passed through). Identity comparison is key-precise because each
  // entry is its own object.
  const markUsed = (values: Record<string, unknown>): void => {
    for (const value of Object.values(values)) {
      for (const key of Object.keys(ctxInputs)) {
        if (value === ctxInputs[key]) used.add(key);
      }
    }
  };

  const provision = (
    id: string,
    child: ServiceNode | ResourceNode | HexNode,
    provisionWiring?: Record<string, unknown>,
    // biome-ignore lint/suspicious/noExplicitAny: HexBuilder's real overload set is checked at the call site; the collector implementation is untyped by design (see the existing service overloads).
  ): any => {
    if (typeof id !== 'string' || id.length === 0) {
      throw new LoadError(`provision() requires a non-empty id (hex "${hexNode.name}").`);
    }
    // The id becomes the node's address segment: configKey joins it with "_"
    // (id "auth_db" + param "url" would collide with id "auth" + input "db" +
    // param "url" — both AUTH_DB_URL), and node ids join path segments with
    // "." — so neither may appear inside an id.
    if (id.includes('_') || id.includes('.')) {
      throw new LoadError(
        `provision() id "${id}" (hex "${hexNode.name}") may not contain "_" or "." — ` +
          '"_" is the config-key separator and "." the node-id path separator; either ' +
          'inside an id collides with the joined form of other names.',
      );
    }
    if (localIds.has(id)) {
      throw new LoadError(`Duplicate provision id "${id}" in hex "${hexNode.name}".`);
    }
    // Brand-check on a widened alias: predicate-narrowing the declared union
    // drops the `any`-instantiated ResourceNode member (the same quirk
    // serviceInputs sidesteps by widening `kind` to a plain string).
    const untrusted: unknown = child;
    if (
      !isNode(untrusted) ||
      (untrusted.kind !== 'service' && untrusted.kind !== 'resource' && untrusted.kind !== 'hex')
    ) {
      throw new LoadError(
        `provision("${id}") expects a branded service, resource, or hex node (construct it with ` +
          "the service()/resource()/hex() factories or a pack's own).",
      );
    }
    localIds.add(id);
    const fullAddress = address === undefined ? id : `${address}.${id}`;

    if (child.kind === 'resource') {
      if (provisionWiring !== undefined) {
        throw new LoadError(
          `provision("${id}") received wiring for a resource — a resource has no inputs to wire.`,
        );
      }
      if (child.type.length === 0) {
        throw new LoadError(`provision("${id}") received a resource with an empty node type.`);
      }
      byId.set(fullAddress, child);
      nodes.push({ id: fullAddress, node: child });
      return refForResource(fullAddress, child);
    }

    const localWiring = { ...(provisionWiring ?? {}) };
    markUsed(localWiring);

    if (child.kind === 'service') {
      const inputs = serviceInputs(child, fullAddress);
      nodes.push(...inputs.nodes, { id: fullAddress, node: child });
      edges.push(...inputs.edges, ...wiringEdges(localWiring, fullAddress));
      pending.push({
        deps: child.inputs,
        wiring: localWiring,
        targetId: fullAddress,
        targetKind: 'service',
        enclosingHexName: hexNode.name,
      });
      byId.set(fullAddress, child);
      return refFor(fullAddress, child);
    }

    edges.push(...wiringEdges(localWiring, fullAddress));
    pending.push({
      deps: child.deps,
      wiring: localWiring,
      targetId: fullAddress,
      targetKind: 'hex',
      enclosingHexName: hexNode.name,
    });
    const childOutputs = flatten(child, fullAddress, localWiring, nodes, edges, pending, byId);
    nodes.push({ id: fullAddress, node: child });
    byId.set(fullAddress, child);
    return blindCast<
      ProvisionedRef,
      "a nested hex's ProvisionedRef is its own id plus its already-validated HexOutputs, matching ProvisionedRef's mapped shape"
    >({ id: fullAddress, ...childOutputs });
  };

  const ctx = blindCast<
    HexContext<Deps>,
    "ctxInputs holds one resolved InputRef per hexNode.deps key (built above from wiring, the same ref-port shape a producer's port has), and provision is exactly HexBuilder['provision'] — together they satisfy HexContext<D> structurally for whatever D this hexNode declares"
  >({
    inputs: ctxInputs,
    provision: blindCast<
      HexBuilder['provision'],
      'single implementation behind the provision() overloads — returns the contract-carrying ref for a resource, a ProvisionedRef for a service, and a ProvisionedRef for a nested hex, exactly what each overload pins, but an object property cannot carry an overloaded implementation signature'
    >(provision),
  });

  const outputs = blindCast<
    Record<string, unknown>,
    'HexOutputs<E> is a mapped type over the declared expose keys; the loop below reads it by key, which is all a Record<string, unknown> view needs'
  >(hexNode.body(ctx));

  // Pass-through: returning an input as an expose port re-offers it to the
  // enclosing scope — that is using it, not ignoring it (hex-composition.md
  // § Forwarding). The consumer of the pass-through output still resolves to
  // the original producer, since the entry read through to its port.
  markUsed(outputs);

  for (const key of Object.keys(hexNode.deps)) {
    if (!used.has(key)) {
      throw new LoadError(
        `Hex "${hexNode.name}" declares input "${key}" but never forwards it into a provision nor returns it as an output.`,
      );
    }
  }

  for (const [key, contract] of Object.entries(hexNode.expose)) {
    const port = outputs[key];
    if (port === undefined) {
      throw new LoadError(
        `Hex "${hexNode.name}" declares expose "${key}" but its body did not return a port for it.`,
      );
    }
    if (!satisfiesRequired(port, contract)) {
      throw new LoadError(
        `Hex "${hexNode.name}"'s returned port for expose "${key}" does not satisfy its declared contract.`,
      );
    }
  }

  return outputs;
}

function loadHex(root: HexNode, opts?: { id?: NodeId }): Graph {
  const rootId = opts?.id ?? root.name;
  const rootDepKeys = Object.keys(root.deps);
  if (rootDepKeys.length > 0) {
    const names = rootDepKeys.map((k) => `"${k}"`).join(', ');
    throw new LoadError(
      `Hex "${root.name}" declares input${rootDepKeys.length > 1 ? 's' : ''} ${names} but is being ` +
        'deployed as the root — a root has no enclosing scope to wire them; compose ' +
        `"${root.name}" from another hex that provisions and wires it instead.`,
    );
  }

  const nodes: GraphNode[] = [];
  const edges: Edge[] = [];
  const pending: PendingWiring[] = [];
  const byId = new Map<string, ServiceNode | ResourceNode | HexNode>();

  flatten(root, undefined, {}, nodes, edges, pending, byId);

  for (const entry of pending) validateWiring(entry, byId);
  assertDependencyDag(edges);

  const rootGraphNode: GraphNode = { id: rootId, node: root };
  return {
    root: rootGraphNode,
    nodes: [...topoSort(nodes, edges), rootGraphNode],
    edges,
  };
}

/**
 * The dependency edges must form a DAG — a cycle means neither producer can
 * deploy first. Resources take no wiring, so only service/hex-to-service/hex
 * edges can ever participate in a cycle; no special-casing needed.
 */
function assertDependencyDag(edges: readonly Edge[]): void {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind !== 'dependency') continue;
    const targets = adjacency.get(edge.from) ?? [];
    targets.push(edge.to);
    adjacency.set(edge.from, targets);
  }

  const visiting = new Set<string>();
  const done = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      const cycle = [...stack.slice(stack.indexOf(id)), id];
      throw new LoadError(`Dependency cycle: ${cycle.join(' → ')} — no deploy order exists.`);
    }
    visiting.add(id);
    stack.push(id);
    for (const next of adjacency.get(id) ?? []) visit(next);
    stack.pop();
    visiting.delete(id);
    done.add(id);
  };

  for (const id of adjacency.keys()) visit(id);
}
