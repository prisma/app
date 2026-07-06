/**
 * Core model: node types and the factories that construct them. All nodes are
 * plain, frozen, serializable data — with exactly three sanctioned behavior
 * slots hanging off the graph: the Service node's handler (`run`), a
 * Connection's `hydrate` (validated values → client), and the Service's
 * ConfigAdapter (the platform's config I/O). Config declarations are pure
 * data; only the adapter touches a real environment. A node's `type` is its
 * routing key at deploy; core never interprets it beyond lookup.
 */

/** JSON-safe config values. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };
export type JsonObject = { [k: string]: JsonValue };

// Brand — set by the factories below; how Load tells a node from junk.
// Symbol.for so the check survives duplicated module instances in a workspace.
const NODE: unique symbol = Symbol.for("makerkit:node") as never;

export interface NodeBase {
  readonly [NODE]: true;
  /** "hex" later — an extension point, not built yet. */
  readonly kind: "service" | "resource";
  /** Routing key, e.g. "prisma-cloud/postgres". */
  readonly type: string;
  /** Constructor opts, opaque to core. */
  readonly config?: JsonObject;
}

// ——— Configuration model (core-owned pipeline; it lives in /runtime) ———

/** Runtime-validatable param types. Curated; extended consciously. */
export type ParamType = "string" | "number";
export type TypeOf<T extends ParamType> = T extends "string" ? string : number;

/**
 * A declared config param — pure data. The declaration does double duty: core
 * validates raw values against `type` at boot, and TypeScript derives the
 * hydrate/handler input types from it — the definition object ENFORCES the
 * final param input types.
 */
export interface ConfigParam<T extends ParamType = ParamType> {
  readonly type: T;
  /** Redacted in any introspection output. */
  readonly secret?: boolean;
  readonly optional?: boolean;
  readonly default?: TypeOf<T>;
}

export type Params = Record<string, ConfigParam>;

/** What implementations receive — undefined only for optional params with no default. */
export type Values<P extends Params> = {
  readonly [K in keyof P]: P[K]["optional"] extends true
    ? undefined extends P[K]["default"]
      ? TypeOf<P[K]["type"]> | undefined
      : TypeOf<P[K]["type"]>
    : TypeOf<P[K]["type"]>;
};

/**
 * The connection face of a dependency: declared params (data) and how
 * validated values become a client (the hydrate behavior slot). Both P and C
 * are INFERRED — the declaration types hydrate's input; the factory types the
 * handler's dep.
 */
export interface Connection<P extends Params = Params, C = unknown> {
  readonly params: P;
  hydrate(values: Values<P>): C | Promise<C>;
}

/**
 * The platform's config I/O, pack-provided and attached to the service node
 * by its constructor. The mapping between semantic params and physical
 * locations is the adapter's PRIVATE business — core never sees platform
 * keys. The adapter owns its source: the platform adapter is the one
 * sanctioned environment reader; an in-memory test adapter reads nothing.
 */
export interface ConfigAdapter {
  /** Raw values keyed by request id; core validates/coerces. */
  get(requests: readonly ConfigRequest[]): Promise<Readonly<Record<string, string>>>;
  /** Tests · deploy plane. */
  set?(values: Readonly<Record<string, string>>): Promise<void>;
  /** Ops introspection: "which physical location is this param?" */
  describe?(request: ConfigRequest): Promise<{ location: string }>;
}

export interface ConfigRequest {
  /** Core-assigned; keys the returned value map. */
  readonly id: string;
  readonly owner: "service" | { readonly input: string };
  readonly name: string;
  readonly param: ConfigParam;
}

// ——— Nodes ———

/**
 * A Resource a service depends on, carrying its connection face. C flows from
 * the connection's hydrate return type into the handler's parameter.
 */
export interface ResourceNode<C = unknown> extends NodeBase {
  readonly kind: "resource";
  readonly connection: Connection<Params, C>;
}

/**
 * A Service: inputs + its own declared params + the platform's ConfigAdapter
 * + the opaque handler. This IS the user's default export — inspectable
 * (inputs/type/params/config) and runnable (run), inert until invoked. There
 * is no separate handle type: the node is the handle.
 */
export interface ServiceNode<D extends Deps = Deps, P extends Params = Params> extends NodeBase {
  readonly kind: "service";
  readonly inputs: D;
  /** Service-level config (e.g. port) — no special "context" concept. */
  readonly params: P;
  readonly adapter: ConfigAdapter;
  run(deps: HydratedDeps<D>, ctx: Values<P>): unknown;
}

/** Dependency map: name → ResourceNode. `any`, not `unknown` — keeps inference. */
export type Deps = Record<string, ResourceNode<any>>;

export type Hydrated<N> = N extends ResourceNode<infer C> ? C : never;
export type HydratedDeps<D extends Deps> = { readonly [K in keyof D]: Hydrated<D[K]> };

/**
 * ctx is nothing special: the service's own resolved params, typed by its
 * declaration.
 */
export type ServiceHandler<D extends Deps, P extends Params> = (
  deps: HydratedDeps<D>,
  ctx: Values<P>,
) => unknown;

function requireType(type: string, factory: string): void {
  if (typeof type !== "string" || type.length === 0) {
    throw new Error(`${factory}() requires a non-empty node type.`);
  }
}

function freezeParams<P extends Params>(params: P): P {
  const frozen: Record<string, ConfigParam> = {};
  for (const [name, param] of Object.entries(params)) {
    frozen[name] = Object.freeze({ ...param });
  }
  return Object.freeze(frozen) as P;
}

/** Constructs a branded, frozen Resource node. Pure — nothing executes. */
export function resource<P extends Params, C>(def: {
  type: string;
  connection: Connection<P, C>;
  config?: JsonObject;
}): ResourceNode<C> {
  requireType(def.type, "resource");
  const connection: Connection<P, C> = Object.freeze({
    params: freezeParams(def.connection.params),
    hydrate: def.connection.hydrate,
  });
  const node: ResourceNode<C> = {
    [NODE]: true,
    kind: "resource",
    type: def.type,
    connection: connection as Connection<Params, C>,
    ...(def.config !== undefined ? { config: Object.freeze(def.config) } : {}),
  };
  return Object.freeze(node);
}

/**
 * Constructs a branded, frozen Service node; `handler` becomes the node's
 * `run`. Pure — the handler is never called here.
 */
export function service<D extends Deps, P extends Params>(def: {
  type: string;
  inputs: D;
  params: P;
  adapter: ConfigAdapter;
  handler: ServiceHandler<D, P>;
  config?: JsonObject;
}): ServiceNode<D, P> {
  requireType(def.type, "service");
  const node: ServiceNode<D, P> = {
    [NODE]: true,
    kind: "service",
    type: def.type,
    inputs: Object.freeze({ ...def.inputs }) as D,
    params: freezeParams(def.params),
    adapter: def.adapter,
    ...(def.config !== undefined ? { config: Object.freeze(def.config) } : {}),
    run(deps, ctx) {
      return def.handler(deps, ctx);
    },
  };
  return Object.freeze(node);
}

/** True if `value` is a node constructed by the service()/resource() factories. */
export function isNode(value: unknown): value is NodeBase {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[NODE] === true
  );
}
