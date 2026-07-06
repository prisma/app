/**
 * Core model: node types and the factories that construct them. All nodes are
 * plain, frozen, serializable data — with exactly three sanctioned behavior
 * slots hanging off the graph: the Service node's handler (`run`), a
 * Connection's `hydrate` (config → client), and nothing else that executes.
 * The Service type's config knowledge is data (an addressing rule), not a
 * provider function. A node's `type` is its routing key at deploy; core never
 * interprets it beyond lookup.
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

// ——— Configuration model (core-owned; the pipeline lives in /runtime) ———

/** A config field a connection needs at boot — declared shape, pure data. */
export interface ConfigField {
  readonly name: string;
  /** Redacted in any introspection output. */
  readonly secret?: boolean;
  readonly optional?: boolean;
}

/**
 * The connection face of a dependency: what it needs (data) and how the
 * needed values become a client (the hydrate behavior slot). C is INFERRED
 * from the app's factory — no phantom types, no declared-vs-actual trust
 * boundary.
 */
export interface Connection<C = unknown> {
  readonly config: readonly ConfigField[];
  hydrate(config: Record<string, string>): C;
}

/**
 * How a Service KIND's platform delivers config — pack-declared DATA plus a
 * pure addressing rule core drives. Core does all reading/resolving; the pack
 * never touches an environment.
 */
export interface HostConvention {
  /** The only channel today. */
  readonly channel: "env";
  /** Addressing rule for input fields, e.g. (_, "url") => "DATABASE_URL". */
  key(input: string, field: string): string;
  /** Context fields resolve via their own key, not the rule above. */
  readonly context: readonly ContextField[];
}

export interface ContextField {
  readonly name: keyof RuntimeContext;
  readonly key: string;
  readonly default?: string | number;
}

// ——— Nodes ———

/**
 * A Resource a service depends on, carrying its connection face. C flows from
 * the connection's hydrate return type into the handler's parameter.
 */
export interface ResourceNode<C = unknown> extends NodeBase {
  readonly kind: "resource";
  readonly connection: Connection<C>;
}

/**
 * A Service: inputs + host convention + the opaque handler. This IS the
 * user's default export — inspectable (inputs/type/host/config) and runnable
 * (run), inert until invoked. There is no separate handle type: the node is
 * the handle.
 */
export interface ServiceNode<D extends Deps = Deps> extends NodeBase {
  readonly kind: "service";
  readonly inputs: D;
  readonly host: HostConvention;
  run(deps: HydratedDeps<D>, ctx: RuntimeContext): unknown;
}

/** Dependency map: name → ResourceNode. `any`, not `unknown` — keeps inference. */
export type Deps = Record<string, ResourceNode<any>>;

export type Hydrated<N> = N extends ResourceNode<infer C> ? C : never;
export type HydratedDeps<D extends Deps> = { readonly [K in keyof D]: Hydrated<D[K]> };

/**
 * What the host provides a running service besides its deps. Core defines the
 * shape; values resolve through the service's HostConvention.
 */
export interface RuntimeContext {
  readonly port: number;
}

export type ServiceHandler<D extends Deps> = (deps: HydratedDeps<D>, ctx: RuntimeContext) => unknown;

function requireType(type: string, factory: string): void {
  if (typeof type !== "string" || type.length === 0) {
    throw new Error(`${factory}() requires a non-empty node type.`);
  }
}

/** Constructs a branded, frozen Resource node. Pure — nothing executes. */
export function resource<C>(def: {
  type: string;
  connection: Connection<C>;
  config?: JsonObject;
}): ResourceNode<C> {
  requireType(def.type, "resource");
  const connection: Connection<C> = Object.freeze({
    config: Object.freeze(def.connection.config.map((field) => Object.freeze({ ...field }))),
    hydrate: def.connection.hydrate,
  });
  const node: ResourceNode<C> = {
    [NODE]: true,
    kind: "resource",
    type: def.type,
    connection,
    ...(def.config !== undefined ? { config: Object.freeze(def.config) } : {}),
  };
  return Object.freeze(node);
}

/**
 * Constructs a branded, frozen Service node; `handler` becomes the node's
 * `run`. Pure — the handler is never called here.
 */
export function service<D extends Deps>(def: {
  type: string;
  inputs: D;
  host: HostConvention;
  handler: ServiceHandler<D>;
  config?: JsonObject;
}): ServiceNode<D> {
  requireType(def.type, "service");
  const host: HostConvention = Object.freeze({
    channel: def.host.channel,
    key: def.host.key,
    context: Object.freeze(def.host.context.map((field) => Object.freeze({ ...field }))),
  });
  const node: ServiceNode<D> = {
    [NODE]: true,
    kind: "service",
    type: def.type,
    inputs: Object.freeze({ ...def.inputs }) as D,
    host,
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
