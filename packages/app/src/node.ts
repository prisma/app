/**
 * Core model: node types and the factories that construct them. All nodes are
 * frozen instances of a small class hierarchy — with two sanctioned behavior
 * slots beyond deploy-time loading: a Connection's `hydrate` (validated
 * values → client) and, on the target pack's runnable service subclass,
 * `run`/`load` (the process controller and its pull-DI). The Service node
 * carries NO handler — it is a description; the code that serves is the app's
 * own entrypoint. Config declarations are pure data; core reads no
 * environment. A node's `type` is its routing key at deploy; core never
 * interprets it beyond lookup.
 *
 * Deploy-only modules (`/target`, `/assemble`) are node-owned: the specifier
 * is author-written data (`targetModule`, `BuildAdapter.assembler`) and the
 * node's own `loadTarget()`/`loadAssembler()`/`assemble()` import it — see
 * ADR-0017. The one invariant to preserve here: every `import()` below takes
 * its specifier from a property read, never a static string literal, so the
 * bundler that inlines this module into the production wrapper cannot follow
 * it and drag the deploy-only module into the runtime artifact.
 */
import { blindCast } from './casts.ts';
import type { ConfigParam, Connection, Params, Values } from './config.ts';
import type { Contract } from './contract.ts';
import type { AssembleInput, Bundle } from './deploy.ts';

// Brand — set by the factories below; how Load tells a node from junk.
// Symbol.for so the check survives duplicated module instances in a workspace.
const NODE: unique symbol = Symbol.for('prisma:node') as never;

/**
 * The runtimes disagree on resolution-failure codes, and agree with each
 * other only loosely: a fully absent package is "MODULE_NOT_FOUND" on bun and
 * "ERR_MODULE_NOT_FOUND" on node; a package that is present but does not
 * export the requested subpath is "ERR_PACKAGE_PATH_NOT_EXPORTED" on node,
 * still "MODULE_NOT_FOUND" on bun. Bun also throws its own ResolveMessage —
 * NOT an Error instance — so this checks `.code` directly rather than
 * narrowing via `instanceof Error` first.
 */
const RESOLUTION_FAILURE_CODES = new Set([
  'MODULE_NOT_FOUND',
  'ERR_MODULE_NOT_FOUND',
  'ERR_PACKAGE_PATH_NOT_EXPORTED',
]);

function isResolutionFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return RESOLUTION_FAILURE_CODES.has(String(error.code));
}

/**
 * Dynamically imports `specifier` (a variable, never a literal at the call
 * site — see the module doc's firewall note), wrapping a failed resolution
 * into a message naming what was being loaded and the specifier itself,
 * instead of letting a bare ERR_MODULE_NOT_FOUND stack trace be the UX. Any
 * other failure (e.g. the resolved module itself throwing on evaluation)
 * propagates unchanged.
 */
async function loadSpecifier(label: string, specifier: string): Promise<unknown> {
  try {
    return await import(specifier);
  } catch (error) {
    if (isResolutionFailure(error)) {
      throw new Error(
        `Cannot resolve the ${label} "${specifier}" — the app (or, for a node provisioned by a ` +
          'system package, that system package) must depend on the package that provides it.',
      );
    }
    throw error;
  }
}

/**
 * The base every node shares: the brand, a diagnostic name, and — for a
 * pack-authored service or resource — the target pack's `/target` module
 * specifier plus the method that loads it. A system or a dependency end never
 * carries `targetModule` (their factories never set it); calling
 * `loadTarget()` on one is a guarded error naming the node.
 */
export abstract class Node {
  readonly [NODE] = true;
  abstract readonly kind: string;
  /** Human-readable, given at authoring — logs/diagnostics only; identity remains the deploy address (ADR-0006). */
  readonly name: string;
  /**
   * The pack's deploy target, e.g. "@prisma/app-cloud/target" — a full,
   * author-written module specifier the pack factory bakes onto the node
   * (`service()`/`resource()`'s `targetModule` option). `undefined` on a system
   * or a dependency end.
   */
  readonly targetModule?: string | undefined;

  protected constructor(init: { name: string; targetModule?: string | undefined }) {
    this.name = init.name;
    this.targetModule = init.targetModule;
  }

  /**
   * Imports this node's `targetModule` and returns the module namespace
   * object, unvalidated — the caller (deploy tooling) checks it exports what
   * it needs (e.g. `fromEnv(): Target`). Deploy-time only; never called from
   * a running service.
   */
  async loadTarget(): Promise<unknown> {
    if (this.targetModule === undefined) {
      throw new Error(
        `"${this.name}" (kind "${this.kind}") declares no targetModule — only a pack-authored ` +
          'service or resource node carries one; deploy tooling only calls loadTarget() on those.',
      );
    }
    return loadSpecifier('target module', this.targetModule);
  }
}

/**
 * How a service's app becomes a runnable artifact. The DESCRIPTOR is pure data
 * the service node carries (rides in service.ts, into every bundle); it names
 * the adapter, the authoring module, and the built-entry location. `entry`
 * (and any other kind-specific path field, e.g. nextjs's `appDir`) resolves
 * RELATIVE TO `dirname(module)` — exactly like an import specifier — never an
 * absolute or machine path. `module` (the authoring module's
 * `import.meta.url`) is the one sanctioned exception to that rule (ADR-0004):
 * deploy-time metadata only, and bundlers preserve it as an expression rather
 * than a literal, so it re-evaluates inside the deploy artifact instead of
 * baking in a dev-machine path.
 */
export interface BuildAdapter {
  /** Assembler routing key, e.g. "node" · "nextjs" — the resolved module's own discriminant, checked against this. */
  readonly kind: string;
  /**
   * The build adapter's `/assemble` module — a full, author-written module
   * specifier the adapter's own factory bakes in (`node()`, `nextjs()`), e.g.
   * "@prisma/app-node/assemble". `ServiceNode.loadAssembler()`/`assemble()`
   * import it directly — never a hardcoded kind→package map, so a community
   * build adapter works with zero changes to core or the CLI.
   */
  readonly assembler: string;
  /**
   * The authoring module's `import.meta.url` — every other path on this
   * descriptor resolves relative to `dirname(module)`. Nothing reads it at
   * runtime.
   */
  readonly module: string;
  /**
   * The app's built runnable, resolved relative to `dirname(module)`. The
   * kind's assembler interprets it. "node": a path to the built server file
   * (e.g. "../dist/server.js"). "nextjs": a bare filename inside the
   * standalone output dir (e.g. "server.js") — see the nextjs adapter's
   * `appDir` for where that output dir itself is anchored.
   */
  readonly entry: string;
}

/**
 * A Resource's identity: the one place a piece of infrastructure exists.
 * Provisioned by a system (`h.provision(id, postgres({ name }))`), never embedded
 * in a service's deps — a service declares a DependencyEnd slot instead and
 * the system wires this node's ref into it. `provides` is the Contract the
 * resource offers consumers (its one port); `type` — the routing key — is
 * derived from `provides.kind`, so wiring a slot to a resource whose contract
 * doesn't satisfy the slot's requirement fails at compile time and at Load,
 * through exactly the machinery service ports use. `pack` is diagnostic only
 * (it names the authoring pack in error messages) — deploy resolution goes
 * through `targetModule`, never `pack`.
 */
// biome-ignore lint/suspicious/noExplicitAny: opaque per-contract Cmp — matches ResourceNode's own bound.
export class ResourceNode<C extends Contract<any, any> = Contract<any, any>> extends Node {
  readonly kind = 'resource' as const;
  /** The pack package name that authored this node, e.g. "@prisma/app-cloud" — diagnostic only. */
  readonly pack: string;
  readonly type: C['kind'];
  /** The Contract this resource provides — the resource's single port. */
  readonly provides: C;

  constructor(init: {
    name: string;
    pack: string;
    type: C['kind'];
    provides: C;
    targetModule?: string | undefined;
  }) {
    super({ name: init.name, targetModule: init.targetModule });
    this.pack = init.pack;
    this.type = init.type;
    this.provides = init.provides;
  }
}

/**
 * A Service: inputs + its own declared params + how it is built. This IS the
 * user's default export — inspectable (inputs/type/params/build), inert until
 * run. It carries NO handler; the app's own entrypoint is the code that serves.
 * The BASE node is not runnable: booting needs a target's environment
 * knowledge, so the pack's factory returns a runnable/loadable subclass that
 * adds `run`/`load` (see RunnableServiceNode). The node is the handle. `pack`
 * is diagnostic only (error messages) — deploy resolution goes through
 * `targetModule` (the target) and `build.assembler` (the build adapter).
 */
export class ServiceNode<
  D extends Deps = Deps,
  P extends Params = Params,
  E extends Expose = Expose,
> extends Node {
  readonly kind = 'service' as const;
  /** The pack package name that authored this node, e.g. "@prisma/app-cloud" — diagnostic only. */
  readonly pack: string;
  readonly type: string;
  readonly inputs: D;
  /** Service-level config declarations (e.g. port). */
  readonly params: P;
  /** How the app's entry is built + assembled. */
  readonly build: BuildAdapter;
  /** Named output ports this service exposes — the Contracts a consumer's `rpc(contract)` can require. `undefined` when the service exposes nothing. */
  readonly expose: E | undefined;

  constructor(init: {
    name: string;
    pack: string;
    type: string;
    inputs: D;
    params: P;
    build: BuildAdapter;
    expose: E | undefined;
    targetModule?: string | undefined;
  }) {
    super({ name: init.name, targetModule: init.targetModule });
    this.pack = init.pack;
    this.type = init.type;
    this.inputs = init.inputs;
    this.params = init.params;
    this.build = init.build;
    this.expose = init.expose;
  }

  /**
   * Imports this service's build adapter's `/assemble` module and returns the
   * module namespace object, unvalidated. Most callers want `assemble()`
   * instead, which also validates and invokes the export.
   */
  async loadAssembler(): Promise<unknown> {
    return loadSpecifier('build assembler', this.build.assembler);
  }

  /**
   * Loads this service's build adapter, validates it exports a callable
   * `assemble`, and calls it with this node's own `build` plus `opts`.
   * Deploy-time only.
   */
  async assemble(opts: Omit<AssembleInput, 'build'> = {}): Promise<Bundle> {
    const mod = await this.loadAssembler();
    const assembleFn =
      typeof mod === 'object' && mod !== null && 'assemble' in mod ? mod.assemble : undefined;
    if (typeof assembleFn !== 'function') {
      throw new Error(
        `"${this.build.assembler}" has no assemble() export — a build-adapter pack must export ` +
          'an assemble(input): Promise<Bundle> function from its assembler entry.',
      );
    }
    const result = await assembleFn({ build: this.build, ...opts });
    return blindCast<
      Bundle,
      "the build adapter's own assemble() contract (AssembleInput => Promise<Bundle>) is only checked at runtime by the typeof-function guard above; the dynamically-imported module's return shape cannot be checked by the compiler"
    >(result);
  }
}

/**
 * The pack's runnable/loadable service node — what a pack's authoring factory
 * (e.g. `compute()`) returns. `run(address, boot)` is the process controller:
 * deserialize the platform environment (keyed off `address`, the bootstrap's
 * parameter) into a typed Config, stash it under process-local keys, then call
 * `boot()` to start the app's entry. `load()` — called from inside that entry —
 * reads the stash, hydrates + memoizes the deps, and returns them typed. Core
 * defines this shape; only a target pack instantiates it.
 */
export interface RunnableServiceNode<
  D extends Deps = Deps,
  P extends Params = Params,
  E extends Expose = Expose,
> extends ServiceNode<D, P, E> {
  run(address: string, boot: () => Promise<unknown>): Promise<unknown>;
  load(): Loaded<D, P>;
}

/**
 * A service's dependency declaration — THE slot, whoever the producer is.
 * Nothing is provisioned FOR it: at Load the enclosing system wires a provisioned
 * producer's ref into it (a service's exposed port, or a resource — the
 * contract determines validity, never the producer's kind), and at deploy it
 * becomes an EDGE from that producer to the consumer. At run it hydrates a
 * client through the Connection machinery; the consumer never learns HOW the
 * producer's address reached it. Declares NO `targetModule` — a dependency
 * end is never provisioned, so deploy tooling never loads a target from one.
 *
 * `Req` is the contract this end requires — `unknown` for an untyped end
 * (e.g. `http()`, the escape hatch that accepts anything). `SystemBuilder.provision`
 * checks each wired ref against `Req` at compile time; `required` carries the
 * same contract as a runtime value so Load can call its `satisfies()` as the
 * backstop.
 */
export class DependencyEnd<C = unknown, Req = unknown> extends Node {
  readonly kind = 'dependency' as const;
  readonly type: string;
  readonly connection: Connection<Params, C>;
  /** The required contract, or `undefined` for an untyped end (e.g. `http()`). */
  readonly required: Req | undefined;

  constructor(init: {
    name: string;
    type: string;
    connection: Connection<Params, C>;
    required: Req | undefined;
  }) {
    super({ name: init.name });
    this.type = init.type;
    this.connection = init.connection;
    this.required = init.required;
  }
}

/**
 * A System: the same boundary a service has — a `Deps` map of typed inputs and
 * an `Expose` map of contract outputs (ADR-0016) — around transparent wiring
 * instead of a black-box body. The body runs at Load (it is wiring, not user
 * code), receives its declared inputs as forwardable wiring values plus
 * `provision`, and returns one ref-port per declared output. `provision()`
 * accepts a system wherever it accepts a service, so systems nest to any depth;
 * a system with an empty boundary is the closed, deploy-root form. Declares NO
 * `targetModule` — a system is never itself provisioned onto a target; its
 * provisioned children are.
 *
 * `body` is declared with METHOD syntax (`body(ctx) {}`), not as a property
 * of function type (`body: (ctx) => ...`) — TypeScript checks a method's
 * parameters bivariantly but a function-typed property's contravariantly, so
 * a property here would make e.g. `SystemNode<{ db: DependencyEnd<...> }, E>`
 * stop being assignable to the `SystemNode<Deps, E>` shape `Load`/`provision()`
 * accept (a real regression the test suite catches). The closure itself is
 * stored under `bodyFn`, typed `unknown` rather than its real function type —
 * a typed function field would reintroduce that same contravariance in `D`
 * even though nothing external reads the field directly (structural
 * assignability between two `SystemNode<D1, E1>`/`SystemNode<D2, E2>` instances
 * still compares every field). `bodyFn` also stays a plain (non-`private`)
 * field: TypeScript's `Object.freeze<T>(o: T): Readonly<T>` produces a fresh
 * mapped type that fails a `private` field's same-declaration identity
 * check, which would break `system()`'s own return statement below.
 */
export class SystemNode<D extends Deps = Deps, E extends Expose = Expose> extends Node {
  readonly kind = 'system' as const;
  readonly deps: D;
  readonly expose: E;
  readonly bodyFn: unknown;

  constructor(init: {
    name: string;
    deps: D;
    expose: E;
    body: (ctx: SystemContext<D>) => SystemOutputs<E>;
  }) {
    super({ name: init.name });
    this.deps = init.deps;
    this.expose = init.expose;
    this.bodyFn = init.body;
  }

  body(ctx: SystemContext<D>): SystemOutputs<E> {
    const fn = blindCast<
      (ctx: SystemContext<D>) => SystemOutputs<E>,
      "bodyFn is stored as unknown specifically to avoid reintroducing D's contravariance (see the class doc comment); the constructor is the only writer, and it always assigns exactly this function type"
    >(this.bodyFn);
    return fn(ctx);
  }
}

/**
 * What a system's body receives: its declared inputs as forwardable wiring
 * values, and `provision` to register the owned services/systems it wires them
 * into. `inputs[K]` stands for "whatever the enclosing scope wires here" —
 * Load resolves it, at the system's own provision() call, to the actual producer
 * the enclosing scope supplied.
 */
export interface SystemContext<D extends Deps> {
  /** The system's declared inputs as wiring values — pass them into provision(). */
  readonly inputs: { [K in keyof D]: InputRef<D[K]> };
  /** Registers an owned child (service or system) under a stable id. */
  readonly provision: SystemBuilder['provision'];
}

/**
 * A system's forwarded-input value: the same ref-port shape a producer's output
 * carries, so it satisfies the identical `Wiring<D>` assignability at any
 * nested `provision()` call — an input flows down by being indistinguishable,
 * at the wiring site, from a sibling's exposed port. Because a dependency
 * slot always carries a contract (resource-backed or service-backed alike —
 * the unified model has no untyped-by-construction resource slot), a
 * resource-backed input forwards across a system boundary exactly like a
 * service-backed one.
 */
export type InputRef<DE> =
  // biome-ignore lint/suspicious/noExplicitAny: matches ReqOf's bound.
  DE extends DependencyEnd<any, infer Req extends Contract<any, any>> ? RefPort<Req> : never;

/** One ref-port per declared expose key, contract-checked against `E` (mirrors `Wiring`'s `NoInfer` use). */
export type SystemOutputs<E extends Expose> = { [P in keyof E]: RefPort<NoInfer<E[P]>> };

/**
 * A provisioned producer's port as a wiring-time value: the port's own
 * contract, tagged with which provider produced it. `provision(id, consumer,
 * wiring)` checks a ref-port's contract against the consumer's required slot
 * (plain assignability); Load reads `__providerId` to resolve the edge and
 * calls the port's own `satisfies()` as the runtime mirror of that check.
 */
// biome-ignore lint/suspicious/noExplicitAny: opaque per-port Cmp — matches Expose's own `any` bound.
export type RefPort<C extends Contract<any, any>> = C & { readonly __providerId: string };

/**
 * What `provision(id, service)` hands back: a stable id — so a service with no
 * exposed ports (or an untyped dependency slot) can still be wired wholesale
 * by passing the ref itself — plus one ref-port per exposed contract (empty
 * when the service declares no `expose`). `provision(id, resource)` returns
 * the same shape with the resource's ONE port — its provided contract —
 * flattened onto the ref itself: `{ id } & RefPort<C>`.
 */
export type ProvisionedRef<E extends Expose = Record<never, never>> = { readonly id: string } & {
  readonly [P in keyof E]: RefPort<E[P]>;
};

/** A DependencyEnd's required contract (unknown for an untyped end). */
// biome-ignore lint/suspicious/noExplicitAny: generic DependencyEnd bound — Req is opaque here.
type ReqOf<DE> = DE extends DependencyEnd<any, infer Req> ? Req : never;

/**
 * `SystemBuilder.provision`'s wiring argument: one producer ref per dependency
 * slot, each checked against the slot's required contract — an untyped
 * input's Req is `unknown`, so it accepts anything (http()'s escape hatch).
 * `NoInfer` keeps the check honest — without it, an incompatible ref would
 * just widen the inferred required type instead of failing.
 */
type Wiring<D extends Deps> = { [K in keyof D]: NoInfer<ReqOf<D[K]>> };

export interface SystemBuilder {
  /**
   * Provisions an owned resource under a stable id — the ONE place that
   * resource exists. Returns the ref (the provided contract, tagged with the
   * id) a later provision() wires into a consumer's dependency slot. A
   * resource is never created because a service mentioned it; this call is
   * the only way one enters the graph.
   */
  // biome-ignore lint/suspicious/noExplicitAny: opaque per-contract Cmp — matches RefPort's own `any` bound.
  provision<C extends Contract<any, any>>(
    id: string,
    resource: ResourceNode<C>,
  ): { readonly id: string } & RefPort<C>;
  /**
   * Registers an owned service under a stable id, returning a ref carrying
   * its exposed ports (if any) for a later provision() to wire in. Also the
   * form for a service with dependency inputs left for the runtime dangling
   * check to catch — TypeScript cannot see whether a service's own inputs got
   * wired anywhere else in the body, only Load can.
   */
  provision<E extends Expose>(
    id: string,
    // biome-ignore lint/suspicious/noExplicitAny: accepts any concrete service node; ServiceNode generics are invariant so `any` is required.
    service: ServiceNode<any, any, E>,
  ): ProvisionedRef<E>;
  /**
   * Registers an owned service under a stable id; `wiring` supplies a
   * producer for each of the service's dependency slots, checked against the
   * slot's required contract — an untyped input's Req is `unknown`, so it
   * accepts anything (http()'s escape hatch); Load re-checks the same
   * relation via the ref's `satisfies()`.
   */
  provision<D extends Deps, E extends Expose>(
    id: string,
    // biome-ignore lint/suspicious/noExplicitAny: accepts any concrete service node; ServiceNode generics are invariant so `any` is required.
    service: ServiceNode<D, any, E>,
    wiring: Wiring<D>,
  ): ProvisionedRef<E>;
  /**
   * Registers an owned child system under a stable id — the same call shape a
   * service gets, since a `SystemNode<D, E>` is wireable anywhere a
   * `ServiceNode<D, _, E>` is (ADR-0016). Left for the runtime dangling check
   * to catch, same as the no-wiring service overload.
   */
  provision<D extends Deps, E extends Expose>(
    id: string,
    child: SystemNode<D, E>,
  ): ProvisionedRef<E>;
  /**
   * Registers an owned child system under a stable id; `wiring` supplies a
   * producer's ref-port for each of the system's declared `deps` — the same
   * `Wiring<D>` check a service's dependency inputs get.
   */
  provision<D extends Deps, E extends Expose>(
    id: string,
    child: SystemNode<D, E>,
    wiring: Wiring<D>,
  ): ProvisionedRef<E>;
}

/**
 * Dependency map: name → the slot the service declares. Only declarations
 * are admitted — a concrete ResourceNode never sits in deps, so a service
 * cannot cause infrastructure to exist by mentioning it. `any`, not
 * `unknown` — keeps inference.
 */
// biome-ignore lint/suspicious/noExplicitAny: `any` (not `unknown`) preserves loaded-dep inference from each entry's hydrate return.
export type Deps = Record<string, DependencyEnd<any, any>>;

/** Output-port map: name → the Contract a service exposes for others to depend on. */
// biome-ignore lint/suspicious/noExplicitAny: opaque per-port Cmp — core never inspects it (see Contract).
export type Expose = Readonly<Record<string, Contract<any, any>>>;

export type Hydrated<N> =
  // biome-ignore lint/suspicious/noExplicitAny: Req is irrelevant to the hydrated shape.
  N extends DependencyEnd<infer C, any> ? C : never;
export type HydratedDeps<D extends Deps> = { readonly [K in keyof D]: Hydrated<D[K]> };

/**
 * What load() returns: the hydrated deps and the service's resolved params,
 * merged for ergonomics (`const { db, port } = service.load()`). Dep and param
 * names are expected distinct; the merge is the surface the app entry consumes.
 */
export type Loaded<D extends Deps, P extends Params> = HydratedDeps<D> & Values<P>;

function requireType(type: string, factory: string): void {
  if (typeof type !== 'string' || type.length === 0) {
    throw new Error(`${factory}() requires a non-empty node type.`);
  }
}

function requireName(name: string, factory: string): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`${factory}() requires a non-empty name.`);
  }
}

function requirePack(pack: string, factory: string): void {
  if (typeof pack !== 'string' || pack.length === 0) {
    throw new Error(`${factory}() requires a non-empty pack (the authoring pack's package name).`);
  }
}

/**
 * `configKey` (the pack's semantic↔physical config mapping) joins address
 * segments, an input's name, and a param's name with "_" and uppercases the
 * result — so an underscore INSIDE a name is indistinguishable from that
 * separator. Without this check, service param "db_url" and input "db"'s
 * param "url" would both serialize to the env key "DB_URL" and silently
 * collide. Rejected at construction, naming the offender.
 */
function requireNoUnderscoreName(name: string, kind: 'input' | 'param', factory: string): void {
  if (name.includes('_')) {
    throw new Error(
      `${factory}() ${kind} name "${name}" may not contain "_" — config keys join names with ` +
        '"_" as the separator (e.g. an input "db"\'s param "url" becomes env key "DB_URL"), so ' +
        'an underscore inside a name would collide with that separator.',
    );
  }
}

function requireNoUnderscoreNames(
  names: Iterable<string>,
  kind: 'input' | 'param',
  factory: string,
): void {
  for (const name of names) requireNoUnderscoreName(name, kind, factory);
}

function freezeParams<P extends Params>(params: P): P {
  const frozen: Record<string, ConfigParam> = {};
  for (const [name, param] of Object.entries(params)) {
    frozen[name] = Object.freeze({ ...param });
  }
  return Object.freeze(frozen) as P;
}

/** A frozen shallow copy that keeps the caller's declared type. */
function frozenShallowCopy<T extends object>(obj: T): T {
  return blindCast<
    T,
    'frozen shallow copy of the caller value; freeze widens the inferred type but the runtime shape is unchanged'
  >(Object.freeze({ ...obj }));
}

/**
 * Constructs a branded, frozen Resource node — an identity plus the Contract
 * it provides; the routing `type` is the contract's `kind`. Pure — nothing
 * executes; nothing is provisioned until a system provisions it. `targetModule`
 * (e.g. "@prisma/app-cloud/target") is the pack factory's own deploy
 * target — an author-written full specifier, never constructed from `pack`.
 */
// biome-ignore lint/suspicious/noExplicitAny: opaque per-contract Cmp — matches ResourceNode's own bound.
export function resource<C extends Contract<any, any>>(def: {
  name: string;
  pack: string;
  provides: C;
  targetModule?: string | undefined;
}): ResourceNode<C> {
  requireName(def.name, 'resource');
  requirePack(def.pack, 'resource');
  const provides = def.provides;
  if (
    typeof provides !== 'object' ||
    provides === null ||
    typeof provides.kind !== 'string' ||
    provides.kind.length === 0 ||
    typeof provides.satisfies !== 'function'
  ) {
    throw new Error(
      'resource() requires `provides` — the Contract this resource offers ' +
        '(a non-empty `kind` plus its `satisfies()`).',
    );
  }
  const node = new ResourceNode<C>({
    name: def.name,
    pack: def.pack,
    type: provides.kind,
    provides,
    targetModule: def.targetModule,
  });
  return Object.freeze(node);
}

/**
 * Constructs a branded, frozen Service node — declarations only (inputs, params,
 * build adapter, and the ports it exposes). Pure; carries no handler.
 * `targetModule` (e.g. "@prisma/app-cloud/target") is the pack factory's
 * own deploy target — an author-written full specifier, never constructed
 * from `pack`.
 */
export function service<
  D extends Deps,
  P extends Params,
  E extends Expose = Record<never, never>,
>(def: {
  name: string;
  pack: string;
  type: string;
  inputs: D;
  params: P;
  build: BuildAdapter;
  expose?: E;
  targetModule?: string | undefined;
}): ServiceNode<D, P, E> {
  requireName(def.name, 'service');
  requirePack(def.pack, 'service');
  requireType(def.type, 'service');
  requireNoUnderscoreNames(Object.keys(def.inputs), 'input', 'service');
  requireNoUnderscoreNames(Object.keys(def.params), 'param', 'service');
  const node = new ServiceNode<D, P, E>({
    name: def.name,
    pack: def.pack,
    type: def.type,
    inputs: frozenShallowCopy(def.inputs),
    params: freezeParams(def.params),
    build: Object.freeze({ ...def.build }),
    expose: def.expose !== undefined ? frozenShallowCopy(def.expose) : undefined,
    targetModule: def.targetModule,
  });
  return Object.freeze(node);
}

/**
 * Constructs a branded, frozen DependencyEnd. Pure — nothing executes; the
 * connection's hydrate runs only through the boot pipeline. `required` (if
 * given) is the contract this end depends on — the same value Load compares
 * a wired ref against via `satisfies()`. `name` is diagnostic only and
 * optional — a consumer's dep key (e.g. `deps: { auth: http({ name: "auth" }) }`)
 * already identifies the end at the wiring site; an unnamed end falls back to
 * its `type`.
 */
export function dependency<P extends Params, C, Req = unknown>(def: {
  name?: string;
  type: string;
  connection: Connection<P, C>;
  required?: Req;
}): DependencyEnd<C, Req> {
  requireType(def.type, 'dependency');
  requireNoUnderscoreNames(Object.keys(def.connection.params), 'param', 'dependency');
  const connection: Connection<P, C> = Object.freeze({
    params: freezeParams(def.connection.params),
    hydrate: def.connection.hydrate,
  });
  const node = new DependencyEnd<C, Req>({
    name: def.name !== undefined && def.name.length > 0 ? def.name : def.type,
    type: def.type,
    connection: connection as Connection<Params, C>,
    required: def.required,
  });
  return Object.freeze(node);
}

/**
 * Constructs a branded, frozen System node. Construction is INERT — the body is
 * wiring, not user code, and runs only when the system is Loaded. `boundary`
 * declares the system's `Deps`/`Expose` the same way a service does; both are
 * optional — an empty boundary (`system(name, {}, body)`) is the closed,
 * deploy-root form, not a separate shape.
 */
export function system<
  D extends Deps = Record<never, never>,
  E extends Expose = Record<never, never>,
>(
  name: string,
  boundary: { deps?: D; expose?: E },
  body: (ctx: SystemContext<D>) => SystemOutputs<E>,
): SystemNode<D, E> {
  requireName(name, 'system');
  const deps = blindCast<
    D,
    'an omitted `deps` only arises when D itself infers to the empty default'
  >(boundary.deps ?? {});
  const expose = blindCast<
    E,
    'an omitted `expose` only arises when E itself infers to the empty default'
  >(boundary.expose ?? {});
  const node = new SystemNode<D, E>({
    name,
    deps: frozenShallowCopy(deps),
    expose: frozenShallowCopy(expose),
    body,
  });
  return Object.freeze(node);
}

/**
 * True if `value` was constructed by this module's factories. Checks the
 * brand ONLY — never `instanceof` — because a graph may mix nodes built by a
 * different installed copy of core (dual-package hazard); the classes above
 * exist for their methods, not for runtime identity.
 */
export function isNode(
  value: unknown,
): value is ServiceNode | ResourceNode | DependencyEnd | SystemNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[NODE] === true
  );
}
