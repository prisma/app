# Core model — classes and data structures

The complete type-level design of `@makerkit/core` and the target-pack contract,
with `@makerkit/prisma-cloud` as the worked instance. This is the implementation
design under [`core-and-targets.md`](../03-domain-model/core-and-targets.md): that
doc says *what* the split is; this one says exactly *which types exist, what fields
they carry, and who imports what*. Scope: the current model — Services with
Resource inputs, service-to-service **Connections**, and the minimal **Hex** that
wires them; typed interfaces and full Hex composition are named extension points.

## Package and entry map

Five entry points, split by dependency weight. The split is enforced, not
aspirational (see § Invariants).

Entries map onto MakerKit's **four planes**. Entry names say *when you import
them*; mechanism terms stay on the functions (`lower()`/`lowering()` — the
glossary's Lowering — live in `/deploy`):

| Plane | What it covers | Home today |
| --- | --- | --- |
| **authoring** | write the model — node factories, model types | `.` (usually reached through a pack's vocabulary) |
| **control** | load / interrogate / mutate the model at build time — `Load`, `configOf`, the topology view | also `.` — see below |
| **deploy** | convert the model to Alchemy for deployment — `lower()`, `lowering()`, `Target` | `/deploy` |
| **execution** | run it — `runHost`, the config pipeline | `/runtime` |

**`/control` is reserved as the settled design direction**: today the control
surface is two pure, lean functions, too little to justify its own entry — but
the moment it grows (the queryable-topology emit, config-declaration tooling, graph
transforms when Hexes arrive), it carves out of `.` into `@makerkit/core/control`.
The boundary is decided; only the carve is deferred.

| Entry | Exports | Imports (weight) |
| --- | --- | --- |
| `@makerkit/core` | node factories (`service`, `resource`), `Load`, `configOf`, model types | nothing |
| `@makerkit/core/deploy` | `lower()`, `Target` types | `alchemy`, `effect` |
| `@makerkit/core/runtime` | `runHost()` | nothing |
| `@makerkit/prisma-cloud` | `compute()`, `postgres({ client })` | `@makerkit/core` only |
| `@makerkit/prisma-cloud/target` | `prismaCloud()` | `@makerkit/prisma-alchemy`, `alchemy`, `effect` |

Per the [runtime-agnostic
principle](../01-principles/architectural-principles.md), no entry imports Bun or
Node APIs — not even type-only. Runtime-specific code (the DB driver, the server
API) appears only in **app files**. The pack has no runtime entry at all: everything
a node needs at boot rides on the node itself (see § Runtime), so the pack splits
into just authoring (lean) and target (heavy, deploy-only).

Who imports what, end to end:

- the **user's service module** imports `@makerkit/prisma-cloud` plus the app's own
  connection definitions (which hold the driver import);
- the **deploy script** (`alchemy.run.ts`) imports the service module +
  `@makerkit/core/deploy` + `@makerkit/prisma-cloud/target` (heavy — deploy-time only);
- the **runtime bundle entry** (`main.ts`, app-owned) imports the service module +
  `@makerkit/core/runtime` — nothing else.

The runtime bundle never contains Alchemy. One accepted consequence: because
connections close over the app's client factory, the deploy script *loads* (never
uses) the driver when it imports the service module — fine under Bun, and mitigable
with a lazy import inside the factory if it ever matters.

## Decision taken: Alchemy is core's provisioning substrate

`@makerkit/core/deploy` imports `alchemy`/`effect`. The architectural principle
forbids core knowledge of **deployment targets** (Prisma Cloud); Alchemy is not a
target — it is the provisioning plane [`layering.md`](../03-domain-model/layering.md)
already commits to (claim 3: MakerKit uses Alchemy's definition language *and*
engine). Putting the engine in core means every target pack supplies only data
(providers + lowerings) instead of re-implementing apply/state. The swap test still
holds: replacing `@makerkit/prisma-cloud` with another pack changes nothing in core.

## The three execution paths

Everything the system does happens on one of three paths. On every path **core is
the only actor**; the pack contributes tools that satisfy an SPI and never sees the
graph, never sequences anything, never calls another tool.

| Path | Where it executes | Core does (the actor) | Pack tools used |
| --- | --- | --- | --- |
| **provision** | deploy machine, via Alchemy | provision the application once (Project + poison vars), then walk the DAG realizing each service's host | `Target.application.provision`, then `ServiceLowering.provision` → identity (App) |
| **deploy** | deploy machine, via Alchemy | ensure every config value the service reads at boot exists *first*, then ship the build | `ServiceLowering.writeConfig` in the seam, then `ServiceLowering.deploy` (version → upload → start → promote) |
| **run** | inside the bundle, in the VM | Load the graph, resolve → validate → hydrate every binding, call the handler | `ConfigAdapter.get`, each connection's `hydrate` |

**provision vs deploy** is the line between "the service exists" and "its code is
running": provision creates identity-bearing infrastructure that changes only when
the topology changes; deploy ships a specific build (keyed by artifact hash) and
changes on every push. The seam between them is the only window where connection
config can land — an environment variable needs the consumer's projectId (exists
after provision) and is read at version start, never after (PRO-211: so it must
exist before deploy). Core sequences `provision → writeConfig → deploy` for every
service, which **eliminates the fresh-deploy config race by construction**, for
every target pack ever written. One producer-side asymmetry: a producer's real URL
is trustworthy only after its *deploy* completes (the create-time endpoint domain
is a placeholder — PRO-200), so core runs a producer through both phases before
touching its consumers' config. (The phase boundary is a claim about platforms —
"identity vs running code" is crisp on Prisma Cloud and most targets, and the SPI
assumes it.)

The paths map onto the entry taxonomy: provision + deploy are reached through
`@makerkit/core/deploy` (one import moment, two SPI phases, different cadence);
run is `@makerkit/core/runtime` — a separate bundle in a separate process. The
deploy path's `writeConfig` and the run path's `ConfigAdapter.get` use the pack's
**one shared name mapping**, so writer and reader cannot drift.

## Core model types (`@makerkit/core`)

All nodes are **plain, frozen, serializable data** — with exactly **three
sanctioned behavior slots** hanging off the graph: the Service node's handler
(`run`), a Connection's `hydrate` (validated values → client), and the Service's
`ConfigAdapter` (the platform's config I/O). Config *declarations* are pure data;
only the adapter touches a real environment. The topology view simply drops the
function slots. A node's `type` is its routing key at deploy; core never
interprets it beyond lookup.

```ts
// Brand — set by the factories below; how Load tells a node from junk.
// Symbol.for so the check survives duplicated module instances in a workspace.
const NODE: unique symbol = Symbol.for("makerkit:node") as never

interface NodeBase {
  readonly [NODE]: true
  readonly kind: "service" | "resource" | "connection"
  readonly type: string                        // routing key, e.g. "prisma-cloud/postgres"
}
// HexNode is deliberately NOT a NodeBase: it has no routing `type` — it is
// transparent wiring, not a routable thing (see § Nodes).

// ——— Configuration model (core-owned pipeline; see § Runtime) ———
//
// Three components, each owned by exactly one party:
//   1. DECLARE — nodes carry semantic param declarations (names + runtime type
//      tags). Target-independent: no platform key names anywhere in the graph.
//   2. GET — core collects declarations and asks the service's ConfigAdapter
//      (pack-provided) for raw values, then validates them against the tags.
//   3. SET — the same adapter concept writes config: in-memory for tests, the
//      deploy plane for real environments (the two-readers idea applied to
//      config — get and set share one mapping, so they cannot drift).

// Runtime-validatable param types. Curated; extended consciously.
type ParamType = "string" | "number"
type TypeOf<T extends ParamType> = T extends "string" ? string : number

// A declared config param — pure data. The declaration does double duty: core
// validates raw values against `type` at boot, and TypeScript derives the
// hydrate/handler input types from it — the definition object ENFORCES the
// final param input types.
interface ConfigParam<T extends ParamType = ParamType> {
  readonly type: T
  readonly secret?: boolean                    // redacted in any introspection output
  readonly optional?: boolean
  readonly default?: TypeOf<T>
}
type Params = Record<string, ConfigParam>
type Values<P extends Params> = {              // what implementations receive
  readonly [K in keyof P]: TypeOf<P[K]["type"]>   // (| undefined when optional with no default)
}

// The connection face of a dependency: declared params (data) and how validated
// values become a client (the hydrate behavior slot). Both P and C are INFERRED —
// the declaration types hydrate's input; the factory types the handler's dep.
interface Connection<P extends Params = Params, C = unknown> {
  readonly params: P
  hydrate(values: Values<P>): C | Promise<C>
}

// The platform's config I/O, pack-provided and attached to the service node by
// its constructor. The mapping between semantic params and physical locations
// (e.g. auth's db.url ↔ AUTH_DB_URL) is the adapter's PRIVATE business — core never sees
// platform keys. The adapter owns its source: the platform adapter is the one
// sanctioned environment reader; an in-memory test adapter reads nothing.
interface ConfigAdapter {
  get(requests: readonly ConfigRequest[]): Promise<Readonly<Record<string, string>>>
                                               // raw values keyed by request id; core validates/coerces
  set?(values: Readonly<Record<string, string>>): Promise<void>   // tests · deploy plane
  describe?(request: ConfigRequest): Promise<{ location: string }> // ops: "which env var is this?"
}
interface ConfigRequest {
  readonly id: string                          // core-assigned; keys the returned value map
  readonly owner: "service" | { readonly input: string }
  readonly name: string
  readonly param: ConfigParam
}

// ——— Nodes ———

// A Resource a service depends on, carrying its connection face. C flows from
// the connection's hydrate return type into the handler's parameter.
interface ResourceNode<C = unknown> extends NodeBase {
  readonly kind: "resource"
  readonly connection: Connection<Params, C>
}

// A Service: inputs + its own declared params + the platform's ConfigAdapter +
// the opaque handler. This IS the user's default export — inspectable
// (inputs/type/params) and runnable (run), inert until invoked. There is no
// separate handle type: the node is the handle.
interface ServiceNode<D extends Deps = Deps, P extends Params = Params> extends NodeBase {
  readonly kind: "service"
  readonly inputs: D
  readonly params: P                           // service-level config (e.g. port) — no special "context" concept
  readonly config: ConfigAdapter               // how this service GETS its config on this platform
  run(deps: HydratedDeps<D>, ctx: Values<P>): unknown
}

// A service-to-service dependency end. Sits in a Deps slot like a ResourceNode,
// but nothing is provisioned FOR it — at deploy it becomes an EDGE to the
// producer service the enclosing hex wires it to; at run it hydrates a client
// through exactly the same Connection machinery as a resource. The consumer
// never learns HOW the producer's address reached it (written env var today;
// runtime name lookup later would change only pack internals).
interface ConnectionEnd<C = unknown> extends NodeBase {
  readonly kind: "connection"
  readonly connection: Connection<Params, C>
}

// Dependency map: name → what the service consumes. Handler types are inferred
// from each entry's hydrate return type — identical mechanics for both kinds.
type Deps = Record<string, ResourceNode<any> | ConnectionEnd<any>>

// A Hex: transparent wiring, no code of its own. The body runs at Load (it is
// wiring, not user code) and provisions the services it owns, supplying a
// producer for every ConnectionEnd input. Minimal form — boundary ports and
// nesting arrive with full Hex composition (see § Extension points).
interface HexNode {
  readonly [NODE]: true
  readonly kind: "hex"
  readonly name: string
  body(h: HexBuilder): void
}
interface HexBuilder {
  // Registers an owned service under a stable id; `wiring` satisfies the
  // service's ConnectionEnd inputs with previously provisioned producers.
  provision(id: string, service: ServiceNode<any, any>,
            wiring?: Record<string, ProvisionedRef>): ProvisionedRef
}
type ProvisionedRef = { readonly id: string }   // opaque handle within the hex body

type Hydrated<N> =
  N extends ResourceNode<infer C> ? C : N extends ConnectionEnd<infer C> ? C : never
type HydratedDeps<D extends Deps> = { readonly [K in keyof D]: Hydrated<D[K]> }

// ctx is nothing special: the service's own resolved params, typed by its
// declaration. On Prisma Cloud, compute() declares { port: number } — so
// handlers receive ({ db }, { port }).
type ServiceHandler<D extends Deps, P extends Params> =
  (deps: HydratedDeps<D>, ctx: Values<P>) => unknown
```

### Node factories

Target packs do not hand-roll node objects — they call core's factories, which brand,
validate, and freeze. This is the whole "framework provides / pack wraps" contract:

```ts
// @makerkit/core
function resource<P extends Params, C>(def: {
  type: string
  connection: Connection<P, C>
}): ResourceNode<C>

function service<D extends Deps, P extends Params>(def: {
  type: string
  inputs: D
  params: P
  config: ConfigAdapter
  handler: ServiceHandler<D, P>
}): ServiceNode<D, P>

function connectionEnd<P extends Params, C>(def: {
  type: string
  connection: Connection<P, C>
}): ConnectionEnd<C>

function hex(name: string, body: (h: HexBuilder) => void): HexNode   // body runs at Load, not here
```

`service()` stores `handler` as the node's `run` and freezes `inputs`/`params`;
`resource()` freezes the connection's declared params. Both throw on an empty
`type`. Nothing executes: constructing nodes is pure.

## Graph and Load (`@makerkit/core`)

```ts
type NodeId = string           // path-derived: root "hello", its input "hello.db"

interface GraphNode { readonly id: NodeId; readonly node: ServiceNode | ResourceNode }
interface Edge { readonly from: NodeId; readonly to: NodeId; readonly input: string }
                               // resource → service, labeled with the input name

interface Graph {
  readonly root: GraphNode
  readonly nodes: readonly GraphNode[]     // root + one per input, topo-ordered (deps first)
  readonly edges: readonly Edge[]
}

function Load(root: ServiceNode, opts?: { id?: NodeId }): Graph   // throws LoadError
class LoadError extends Error {}
```

Load accepts a service or a hex root. For a service it walks `root.inputs`, assigns
ids, builds edges. For a hex it **executes the body** (the body is wiring, not user
code — running it at Load is the designed exception to imports-run-nothing) with a
collector `HexBuilder`, producing the owned services and one **connection edge**
per wired ConnectionEnd input. Edges now carry a kind: `input` (service consumes a
resource) or `connection` (service calls a service). Validation: every node
branded with a non-empty `type`; every ConnectionEnd input of a provisioned
service **wired to a provisioned producer** (dangling connection = LoadError); the
connection edges form a **DAG** (a cycle is a LoadError with the cycle named — a
consequence of address-at-deploy-time wiring: if A needs B's address to deploy and
B needs A's, neither can go first). A lone service Loaded outside any hex may have
unwired ConnectionEnds — connectedness is a topology-level check; booting it
unwired still fails loudly through the ordinary missing-config path. Load
executes nothing of the user's — the graph
is data in memory to inspect or hand to `lower`/`runHost`. A **topology view** —
nodes as `{ id, kind, type }` plus edges, function slots dropped — is
`JSON.stringify`-able by construction; the serialized-artifact emit step builds on
this later.

## Lowering (`@makerkit/core/deploy`)

The router. Core's only job at deploy: Load, then look up each node's `type` in the
target's lowering table and run what it finds, deps before dependents.

```ts
import type { Layer } from "effect"
import type { Effect } from "effect"

// What a target pack's /target entry produces — data + per-type SPI functions.
// The pack is never the actor: these are tools core invokes at moments core
// chooses; none sees the graph, sequences anything, or calls another.
interface Target {
  readonly name: string
  providers(): Layer.Layer<never>                       // the pack's Alchemy providers
  readonly application: ApplicationLowering             // once per lowering, before anything else
  readonly resources: Record<string, Lowering>          // resource type id → one-shot lowering
  readonly services: Record<string, ServiceLowering>    // service type id → phased SPI
}

// The application's shared infrastructure: on Prisma Cloud, the one Project
// (the config namespace and lifecycle boundary) plus the poison DATABASE_URL
// variables. Its outputs (projectId) reach every later SPI call via
// LowerContext.application.
interface ApplicationLowering {
  provision(ctx: LowerContext): Effect.Effect<LoweredNode, unknown, unknown>
}

// The phased service SPI — the seam between the phases belongs to CORE.
interface ServiceLowering {
  // provision: make the target-specific thing that will host the service —
  // identity-bearing infrastructure only (the App), inside the application's
  // Project (ctx.application); no code runs.
  provision(ctx: LowerContext): Effect.Effect<LoweredNode, unknown, unknown>
  // writeConfig: make these param values exist in the service's runtime
  // environment (on Prisma Cloud: EnvironmentVariables on the project). Uses
  // the SAME name mapping the pack's ConfigAdapter reads with at boot.
  writeConfig(provisioned: LoweredNode, values: readonly ResolvedParam[]):
    Effect.Effect<void, unknown, unknown>
  // deploy: ship a specific build into the provisioned thing and run it
  // (version → upload → start → promote). Returns the trustworthy URL.
  deploy(ctx: LowerContext, provisioned: LoweredNode):
    Effect.Effect<LoweredNode, unknown, unknown>
}
interface ResolvedParam { readonly request: ConfigRequest; readonly value: string }

// One node's realization. Runs inside the Alchemy stack effect; yields the
// pack's Alchemy resources. Core never looks inside.
type Lowering = (ctx: LowerContext) => Effect.Effect<LoweredNode, unknown, unknown>

interface LowerContext {
  readonly id: NodeId
  readonly node: ServiceNode | ResourceNode
  readonly graph: Graph
  readonly opts: LowerOptions
  readonly application: LoweredNode                     // the application provision's outputs
  readonly lowered: ReadonlyMap<NodeId, LoweredNode>    // already-lowered deps (topo order)
}

// What a lowering hands downstream — e.g. a deployed URL a later node's env
// wiring consumes. The inter-node config-wiring hook for Connections.
interface LoweredNode { readonly outputs: Readonly<Record<string, unknown>> }

interface LowerOptions {
  readonly name: string                                  // stack name (+ root id for a service root)
  // Artifacts are app-built (MakerKit does not bundle). Service root: one
  // artifact. Hex root: one per provisioned service, keyed by provision id.
  readonly artifact?: Artifact
  readonly artifacts?: Record<string, Artifact>
  readonly stage?: string
  readonly state?: AlchemyStateLayer                     // default: localState(); the
                                                         // hosted-state store slots in here
}
interface Artifact { readonly path: string; readonly sha256: string }

// Load → route each node through target.lower[node.type] → an Alchemy Stack
// (the default export the alchemy CLI consumes). Unknown type → LowerError
// naming the type and the target's known types.
function lower(root: ServiceNode, target: Target, opts: LowerOptions): AlchemyStack
class LowerError extends Error {}

// Composable form — for MIXED topologies: MakerKit-authored nodes beside
// hand-wired Alchemy resources in one stack. Runs the same Load → route walk
// inside the caller's stack effect and returns the root's LoweredNode, whose
// outputs (e.g. the deployed URL) hand-wired resources may consume.
// Error channel: LowerError from routing, PLUS whatever a pack lowering fails
// with (their error type is open) — a mixed-stack caller treats failures as
// deploy-fatal or inspects; it must not assume LowerError is the only inhabitant.
function lowering(root: ServiceNode, target: Target, opts: LowerOptions):
  Effect.Effect<LoweredNode, LowerError, unknown>
```

`lower()` is nothing but the whole-stack wrapper:
`Alchemy.Stack(opts.name, { providers: target.providers(), state: opts.state ?? localState() }, lowering(root, target, opts))`
— Alchemy requires a state layer; local state is the default and a hosted store is
config, not a code change. Two type-level notes the wrapper carries (both commented
at the single site): a `LowerError` is fatal at deploy (`Effect.orDie`), and the
effect's requirements channel is narrowed to what `Alchemy.Stack` accepts —
`lowering()` itself stays `unknown`-requirements for composability.
In the mixed case the hand-written stack supplies providers itself (including the
target's, via `target.providers()`), yields a `lowering(…)` per MakerKit-authored
service, and wires its own resources around the returned `outputs`.

**Core's deploy-path sequencing** — the control flow no pack can misorder.
First, `application.provision` runs once (the Project, with the poison
`DATABASE_URL` variables). Then walk services in topological order over the
connection edges (the DAG Load validated); for each service:

1. Lower its resource inputs via `Target.resources` (e.g. the service's own
   Database + Connection — outputs carry the url).
2. `provision` — the service now has identity (its App).
3. Resolve every declared param that comes from the graph: resource-backed
   params from the resource lowerings' outputs (the database url), wired
   ConnectionEnd params from the **producer's deploy outputs** (the producer,
   earlier in topo order, is already fully deployed — its URL is real, not the
   create-time placeholder).
4. `writeConfig` with all resolved params — every value the service boots with,
   database URLs included, lands as the service's own named variables. Never
   the platform default.
5. `deploy` — the first version snapshots an environment that is already
   complete. **How the ordering is actually enforced:** our walk only
*assembles* Alchemy resource descriptions — Alchemy executes them in dependency
order and runs unordered resources concurrently; declaration order is never
consulted. So core realizes the sequence as **dependency edges**: most arise
naturally from value flow (the env var consumes the project id and the
producer's URL), and the one that doesn't — deploy-after-writeConfig — exists
because the `Deployment` resource declares the environment records it boots
with as a prop, which is PDP's own dataflow restored (the version-create call
literally contains the materialized env map). See the lowering graphs in
[`../05-prisma-cloud/alchemy-lowering.md`](../05-prisma-cloud/alchemy-lowering.md).
The same edge also propagates change: a producer's new URL diffs the consumer's
`Deployment` props → new version → new snapshot, the only propagation mechanism
PDP's snapshot-per-version semantics permit. This is what makes the fresh-deploy
config race (PRO-211) structurally impossible on every target.

Notes:

- **Target-specific identity** (workspace id, region) never appears in
  `LowerOptions` — it is captured by the pack's target constructor
  (`prismaCloud({ workspaceId })`). Core's options are target-neutral.
- **The artifact is an input, not a product.** The app bundles (tsdown, Bun.build,
  whatever) and passes path + sha256. Core has no build step; the hash in the
  options is what makes a rebuild register as a change.

## Runtime: the config pipeline (`@makerkit/core/runtime` + `configOf` in core)

At boot, three things have to happen: obtain this platform's config values, turn
them into clients, and call the handler. The responsibilities are split so that
**core owns config management end to end** while caring nothing about the mapping:

- **declarations** (connections' `params`, the service's own `params`) say *what*
  is needed — semantic names + runtime type tags. Target-independent data.
- the **`ConfigAdapter`** (pack-provided, on the service node) answers *get* and
  *set* for its platform; the semantic↔physical mapping is its private business.
- **core** does everything in between: enumerate, request, validate, coerce,
  intercept, distribute, call.

```ts
// The enumerable config surface of a service — derivable from the graph alone,
// nothing booted, no platform keys. The introspection artifact (secrets marked,
// values absent). Physical locations are the adapter's business (describe()).
interface ConfigDeclaration {
  readonly owner: "service" | { readonly input: string }
  readonly name: string              // "url" · "port"
  readonly type: ParamType
  readonly secret: boolean
  readonly optional: boolean
  readonly default?: string | number
}
function configOf(root: ServiceNode): readonly ConfigDeclaration[]   // in @makerkit/core (pure)

// Boot: Load → configOf → adapter.get(requests) → per-param: override ?? raw ??
// default → validate + coerce against the declared type. Validation rules:
//   · "" is UNRESOLVED, not a value — it falls to the default or, if required,
//     joins the missing set;
//   · a NON-EMPTY value that fails its declared type is an ERROR regardless of
//     any default — a default substitutes for absence, never for garbage;
//   · unknown override keys are errors (a typoed override must not silently
//     fall through to the platform value).
// ALL problems reported in one ConfigError, before any hydrate
// (Load-before-Hydrate applied to config) → per input:
// await connection.hydrate(typedValues) → root.run(deps, serviceParamValues).
function runHost(root: ServiceNode, opts?: {
  config?: ConfigAdapter                       // swap the platform adapter: in-memory tests, inspection harnesses
  overrides?: Record<string, string | number>  // per-param overrides, applied before the adapter is
                                               // consulted; keyed "input.param" (dotted) for input params,
                                               // bare "param" for service-level params
}): Promise<unknown>
class ConfigError extends Error {}             // names every missing/invalid/unknown param at once
```

Core and user code contain **zero** environment reads: the platform's adapter is
the single sanctioned reader for its platform (an in-memory test adapter reads
nothing). Because core is the single resolver, there is one choke point for
interception: tests override per-param or swap the adapter entirely; a production
host can report its resolved config with secrets redacted by construction
(`secret` is declared on the param).

**Motivation (why this shape, recorded).** Two discarded iterations:

*First*, a pack-exported `runtime()` carrying a type-id–keyed hydrator table plus
app-supplied client factories. Discarded because: (1) an opaque `env → config`
provider loses the config surface — no enumeration, no interception point, no
introspection of a running service; (2) it made the pack a second environment
reader; (3) composition across packs required merging registries, where the
node-carried design composes structurally; (4) the app-declared phantom client
type (`postgres<SQL>()`) created a declared-vs-actual trust boundary that factory
inference eliminates; (5) it contradicted the settled decision that *MakerKit
manages the config-to-input mapping*.

*Second*, a `HostConvention` on the service node — addressing as data (channel
enum + a `key(input, field)` naming rule + context fields). Discarded because:
(1) it baked **platform key names into the graph**, coupling every service's
config surface to its target — declarations should be target-independent; (2)
the `channel` discriminator was an enum-switch waiting to grow inside core,
against "compose, don't special-case"; (3) it had no *write* side — tests,
deploy-plane config creation, and inspection all need `set`, which an addressing
rule can't express. The adapter model keeps declarations semantic, makes the
mapping the adapter's private business, and gives get/set/describe one home per
platform.

## The Prisma Cloud pack (`@makerkit/prisma-cloud`) — worked instance

Authoring entry — nodes carrying their connection/host knowledge; the driver is a
**parameter**, so the pack ships none and the client type is inferred:

```ts
import { resource, service, type Connection, type Deps, type ServiceHandler, type ServiceNode } from "@makerkit/core"

export interface PostgresConfig { readonly url: string }

// The app supplies the client factory; C is inferred from its return type.
export const postgres = <C>(opts: { client: (config: PostgresConfig) => C | Promise<C> }): ResourceNode<C> =>
  resource({
    type: "prisma-cloud/postgres",
    connection: {
      params: { url: { type: "string", secret: true } },
      hydrate: (v) => opts.client({ url: v.url }),   // v: { url: string } — enforced by the declaration
    },
  })

// A service-to-service dependency. Default client is a thin URL-anchored fetch
// wrapper (fetch is standard across runtimes — no driver, no runtime coupling);
// an app factory can replace it. The typed generated client arrives with the
// interface primitive (§ Extension points).
export interface HttpClient { readonly url: string; fetch(path: string, init?: RequestInit): Promise<Response> }
export const http = <C = HttpClient>(opts?: { client?: (cfg: { url: string }) => C }): ConnectionEnd<C> =>
  connectionEnd({
    type: "prisma-cloud/http",
    connection: {
      params: { url: { type: "string" } },
      hydrate: (v) => (opts?.client ?? defaultHttpClient)({ url: v.url }),
    },
  })

const computeParams = { port: { type: "number", default: 3000 } } as const

export const compute = <D extends Deps>(
  deps: D,
  handler: ServiceHandler<D, typeof computeParams>,   // ctx: { port: number }
): ServiceNode<D, typeof computeParams> =>
  service({
    type: "prisma-cloud/compute",
    inputs: deps,
    params: computeParams,
    config: computeAdapter,
    handler,
  })

// The platform adapter — the pack's single environment reader. The semantic↔
// physical mapping lives HERE, private to the pack, and is SHARED with the
// deploy path's writeConfig (one module, both directions). Keys are unique per
// service within the application's shared project namespace: the mapping
// prefixes them with the service's identity, which writeConfig records as a
// reserved MakerKit variable so the boot side can reconstruct the same names.
// The platform's DATABASE_URL is never among them — it is forbidden and
// poisoned at project provision (see 05-prisma-cloud/alchemy-lowering.md).
const computeAdapter: ConfigAdapter = {
  async get(requests) {
    const values: Record<string, string> = {}
    for (const r of requests) {
      const raw = process.env[envKey(r)]          // envKey: the shared mapping module
      if (raw !== undefined) values[r.id] = raw
    }
    return values
  },
  async describe(r) {
    return { location: `env:${envKey(r)}` }
  },
}
```

Target entry — the lowering table (the only place `prisma-alchemy` is imported):

```ts
import * as Effect from "effect/Effect"
import * as Prisma from "@makerkit/prisma-alchemy"
import type { Target } from "@makerkit/core/deploy"

export interface PrismaCloudOptions {
  workspaceId: string
  region?: Prisma.ComputeRegion   // the pack imports prisma-alchemy freely — use its union
}

export const prismaCloud = (o: PrismaCloudOptions): Target => ({
  name: "prisma-cloud",
  // One commented cast: prisma-alchemy's providers() satisfies Stack's provider
  // requirements at runtime but not structurally (pre-existing upstream typings
  // gap; same error exists untypechecked in the hand-written examples). The cast
  // lives here in the pack — never in core — until fixed in prisma-alchemy.
  providers: () => Prisma.providers() as unknown as Layer.Layer<never>,

  // Runs ONCE per lowering, before any service: the application's Project,
  // with the poison DATABASE_URL/DATABASE_URL_POOLED variables written
  // immediately so nothing can ever rely on the platform default.
  application: {
    provision: ({ opts }) =>
      Effect.gen(function* () {
        const project = yield* Prisma.Project(`${opts.name}-project`, {
          workspaceId: o.workspaceId, name: opts.name,
        })
        for (const key of ["DATABASE_URL", "DATABASE_URL_POOLED"]) {
          yield* Prisma.EnvironmentVariable(`${key}-poison`, {
            projectId: project.id, key, value: "", class: "production",  // "" preferred; "-" if the API rejects empty
          })
        }
        return { outputs: { projectId: project.id } }
      }),
  },

  resources: {
    // Each postgres input gets its own Database in the application's project.
    // The url output is resolved into the service's db.url param and written
    // through writeConfig under the service's own named key — never the
    // platform default.
    "prisma-cloud/postgres": ({ id, application }) =>
      Effect.gen(function* () {
        const db = yield* Prisma.Database(`${id}-db`, {
          projectId: application.outputs.projectId, name: id,
        })
        const conn = yield* Prisma.Connection(`${id}-conn`, { databaseId: db.id })
        return { outputs: { url: conn.url } }
      }),
  },

  services: {
    "prisma-cloud/compute": {
      // The service as a PLACE inside the application's Project: the App,
      // identity-bearing only, no code runs.
      provision: ({ id, application }) =>
        Effect.gen(function* () {
          const svc = yield* Prisma.ComputeService(`${id}-svc`, {
            projectId: application.outputs.projectId,
            name: id, region: o.region ?? "us-east-1",
          })
          return { outputs: { serviceId: svc.id, projectId: application.outputs.projectId } }
        }),

      // Make these values exist in the service's runtime environment — via the
      // SAME envKey mapping the ConfigAdapter reads with at boot (one module,
      // both directions; writer and reader cannot drift).
      writeConfig: (provisioned, values) =>
        Effect.gen(function* () {
          for (const { request, value } of values) {
            yield* Prisma.EnvironmentVariable(`${envKey(request)}-var`, {
              projectId: provisioned.outputs.projectId,
              key: envKey(request), value, class: "production",
            })
          }
        }),

      // A specific BUILD into the place: version → upload → start → promote.
      // deployedUrl is read post-promote — the create-time domain is a
      // placeholder (PRO-200).
      deploy: ({ id, opts }, provisioned) =>
        Effect.gen(function* () {
          const deploy = yield* Prisma.Deployment(`${id}-deploy`, {
            computeServiceId: provisioned.outputs.serviceId,
            artifactPath: artifactFor(opts, id).path,
            artifactHash: artifactFor(opts, id).sha256,
            port: 3000,
          })
          return { outputs: { url: deploy.deployedUrl, projectId: provisioned.outputs.projectId } }
        }),
    },
  },
})
```

There is **no runtime entry**: the connection and host knowledge above already
rides on the nodes, so `runHost(service)` needs nothing else. (A missing client
factory is now impossible by construction — `postgres({ client })` requires it at
authoring, at compile time.)

## The app, end to end

Three app-owned files; bundling stays hand-rolled in the app:

```ts
// src/connections.ts — app-owned connection definitions; the driver import lives HERE
import { postgres } from "@makerkit/prisma-cloud"
import { SQL } from "bun"                       // the APP's choice of client

export const db = postgres({ client: ({ url }) => new SQL({ url }) })
// typeof hydrated db = SQL — inferred from the factory, no phantom declaration

// src/service.ts — the authored service
import { compute } from "@makerkit/prisma-cloud"
import { db } from "./connections"

export default compute({ db }, ({ db }, { port }) =>
  Bun.serve({ port, hostname: "0.0.0.0",
    fetch: async () => Response.json(await db`select 1 as ok`) }))

// src/main.ts — runtime bundle entry (app-owned); the whole thing
import service from "./service"
import { runHost } from "@makerkit/core/runtime"

runHost(service)

// alchemy.run.ts — deploy (heavy imports; never bundled)
import service from "./src/service"
import { lower } from "@makerkit/core/deploy"
import { prismaCloud } from "@makerkit/prisma-cloud/target"
export default lower(service, prismaCloud({ workspaceId: requiredEnv("PRISMA_WORKSPACE_ID") }), {
  name: "hello",
  artifact: { path: "dist/hello.tar.gz", sha256: sha256File("dist/hello.tar.gz") },
})
```

The app's build script bundles `src/main.ts`, writes `compute.manifest.json`
pointing at the bundle, and tars — ~10 lines the app owns, not MakerKit.

Note where Bun appears: only in these app files (`Bun.serve` in the handler, `new
SQL` in `connections.ts`) — the app's choice, since it deploys to a platform whose
runtime is Bun. Switching the client to node-postgres, or the app to a Node
platform, changes these app lines and nothing in MakerKit.

And note what a test needs: `runHost(service, { overrides: { "db.url": testUrl } })`
— a per-param override through core's resolver, no environment faked, no cloud.
Or skip `runHost` entirely and call `service.run(fakes, { port: 0 })` with fakes at
the inputs — the same dependency inversion the model promises.

### Two services, connected — the hex

The storefront-auth shape, on the primitive (this replaces the hand-written mixed
stack: the ten lines of URL plumbing, the `requireStringOutput` guard, and the
hand-named `EnvironmentVariable` all disappear into core's sequencing):

```ts
// storefront service — declares the dependency; never learns how the address arrives
const auth = http()
export default compute({ auth }, async ({ auth }, { port }) => {
  // auth: HttpClient — e.g. await auth.fetch("/verify")
})

// the app's hex — transparent wiring, runs at Load
import authService from "./hexes/auth/src/service"
import storefrontService from "./hexes/storefront/src/service"

export default hex("storefront-auth", (h) => {
  const authRef = h.provision("auth", authService)
  h.provision("storefront", storefrontService, { auth: authRef })  // wires the edge
})

// alchemy.run.ts — the whole deploy script
export default lower(appHex, prismaCloud({ workspaceId }), {
  name: "StorefrontAuth",
  artifacts: { auth: authArtifact, storefront: storefrontArtifact },
})
```

At deploy, core sequences: auth provision → auth deploy (URL now real) → storefront
provision → `writeConfig` (auth's URL lands as the storefront's `auth.url` param,
under the pack's env-key mapping) → storefront deploy — first VM boots with its
config present. At run, the storefront's pipeline hydrates `auth` into a client
exactly as it hydrates `db`; the handler cannot tell the two mechanisms apart.

## Invariants (enforced, not aspirational)

1. **Core has no target dependency**: `@makerkit/core`'s `package.json` depends on
   neither `@makerkit/prisma-alchemy` nor any `prisma-*` package — checked by a test.
2. **Authoring imports stay lean**: bundling a module that imports `@makerkit/core`
   and `@makerkit/prisma-cloud` (authoring entries only) contains no
   `alchemy`/`effect`/`prisma-alchemy`/`new SQL(` tokens — the existing import-split
   guard test, extended to the pack.
3. **Importing runs nothing**: constructing nodes is pure; only `runHost`/the alchemy
   CLI execute anything.
4. **Core and user code contain zero environment reads.** The platform adapter is
   the single sanctioned reader for its platform — `process.env` appears exactly
   once per pack, inside its `ConfigAdapter`; an in-memory test adapter reads
   nothing. Declarations, resolution, validation, and distribution never touch an
   environment.
5. **No runtime coupling**: neither core nor a target pack imports Bun or Node APIs
   — even type-only — in its shipped surface (the [runtime-agnostic
   principle](../01-principles/architectural-principles.md)). Drivers and server APIs
   enter only from app files; the import-guard test extends to `"bun"`/`node:`
   tokens.

## Extension points (designed for, not yet built)

- **Typed connection interfaces + generated clients** — today `http()` hydrates to
  a plain URL-anchored client; the next step is declaring the interface of a
  connection (routes, request/response bodies), enforcing compatibility at Load,
  and hydrating a generated, strongly-typed client.
- **Full Hex composition** — the minimal hex wires services; boundary ports
  (a hex's own Inputs/Outputs), nesting, and forwarding per the authoring-surface
  design come next. Services stay opaque leaves.
- **Runtime name lookup** — if the platform gains service-name resolution, the
  pack's `writeConfig` becomes a no-op and its connection hydrate resolves by name;
  consumers are unchanged (they never learned how the address arrived).
- **Registry exhaustiveness** — `Target.lower` is a string-keyed record; a pack can
  tighten it to its own type-id union for compile-time exhaustiveness. Core stays
  stringly-typed by design at deploy (it routes); the runtime side has no registry
  at all — behavior rides the nodes.
- **Deploy-side `set`** — when the Connection primitive wires a producer's URL
  into a consumer (today's hand-wired `AUTH_URL`), the deploy plane writes it
  through the same adapter mapping the runtime reads through — the two readers,
  applied to config, so get and set cannot drift. Per-input key naming (multiple
  databases) also lands privately in the pack adapter when it arrives.
- **`ParamType` growth** — the tag set is `"string" | "number"`, curated; new tags
  (`"boolean"`, `"url"`, …) are added consciously with their validation, never as
  an open plugin surface.
- **Serialized topology** — the topology view of Graph is already JSON-safe; an emit
  step for external tooling is additive.

## Related

- [`../03-domain-model/core-and-targets.md`](../03-domain-model/core-and-targets.md) — the architectural split this implements.
- [`../03-domain-model/authoring-surface.md`](../03-domain-model/authoring-surface.md) — the developer-facing narrative.
- [`../03-domain-model/layering.md`](../03-domain-model/layering.md) — Alchemy as the provisioning plane (claim 3).
