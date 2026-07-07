# R4 design note — the runnable node, identity by address, and config as a pack round-trip

This note is the exhaustive design for slice R4 after decision 8. It records the
*why* and the rejected alternatives; the timeless contract is
[`core-model.md`](../../../../docs/design/10-domains/core-model.md) and
[`05-prisma-cloud/*`](../../../../docs/design/05-prisma-cloud/). Where the two
disagree, the timeless docs win — this note explains them.

## The problem this slice hit

Two services now share one PDP Project (decision 7). Their config lives in one
flat, project-scoped environment: every App in the Project boots a
**byte-identical** env, snapshotted at version-create (proven from PDP source —
[pdp-data-model.md](../../../../docs/design/05-prisma-cloud/pdp-data-model.md)).
So a service cannot discover *which* service it is from the environment — a
"who am I" variable is one shared key, last write wins. The consumer's config
keys must be namespaced per service, and the boot side must know its own
namespace to read them. That identity has to come from somewhere the environment
can't provide.

## The settled model, in one paragraph

A node's identity is its **address** — the path of provision ids from the app
root, assigned by the framework from graph position (never user-supplied, so
registry hexes with common internal names like `db`/`service` never collide).
The address reaches the running VM through the only per-service channel that
exists — the **artifact** — as a generated **bootstrap** that calls the node's
own `.run(address)`. Core owns *structure* (the topological walk, the config
shape); the target pack owns *environment* (how config is encoded into and out
of the platform, plus the two touchpoints — the bootstrap printer and `.run` —
that bracket a running instance). Config crosses the core/pack boundary as a
**fully-typed Config value**: core builds it from the graph, the pack serializes
it to env strings at deploy and reconstructs the identical typed Config at boot.

## Responsibility split

**Core owns structure — everything derivable from the graph, target-independent:**
- **Load / the topological walk.** Given a node, what it depends on (its inputs);
  given a hex, the provisioned services and their connection edges; the address
  of every node from its position; DAG validation.
- **The config *shape*** — `configOf(node)` → the declarations (owner, name,
  type, secret, optional, default). This is the enumeration/visibility surface
  R3 required: you can inspect what config a service needs without booting it.
- **Building the typed Config at deploy** — matching each input's declared params
  to the lowered producer/resource outputs (by name) and filling service-param
  defaults, producing a `Config` value handed to the pack.
- **Hydrate + invoke** — given a concrete `Config`, call each input's
  `connection.hydrate` with its typed slice and then the service handler
  (`.invoke`). Structural; the handler cannot tell a resource dep from a
  connection dep.
- **Deploy sequencing** — application.provision once, then per service in topo
  order: resources → provision → build Config → serialize → package → deploy,
  realized as Alchemy dependency edges (never statement order).

**The target pack owns environment — encoding and the running-instance touchpoints:**
- **`serialize(config)`** (deploy, in `/target`) — the typed Config → platform
  env writes (Prisma Cloud: one `EnvironmentVariable` per leaf, keyed by the
  pack's own naming, value = the provisioning ref so the dependency edge exists).
- **`deserialize(env)`** (boot, on the node) — the platform env strings →
  the identical typed Config. The pack reverses its own encoding, so reliability
  (a value missing or unparseable) is the pack failing loudly, not a core check.
- **`.run(address, opts?)`** (boot) — on the pack's `ServiceNode` subclass:
  deserialize → core hydrate+invoke. Carries the pack's single `process.env`
  read. This is what the bootstrap calls.
- **The bootstrap printer** (deploy, in `/target`) — emits `bootstrap.js`
  encoding the address (and anything else the target needs); assembles the
  artifact envelope (`package`).

The pack owns *both ends* of the deploy→boot channel — serialize/deserialize and
printer/`.run` — so it can pass whatever it needs through, and core never sees a
platform key or a wire format. serialize and deserialize share one internal
pack codec module (env-free), so the writer and reader cannot drift — the same
guarantee the old shared `envKey` module gave, now over a typed Config.

## Interfaces (the shapes the build targets; core-model.md is authoritative)

### Core

```ts
// The resolved, typed configuration of one service. Core builds it at deploy
// (leaf values are provisioning refs → the env dependency edge); the pack
// serializes it and reconstructs it at boot (leaf values concrete). Both forms
// conform to the shape from configOf.
interface Config {
  readonly service: Readonly<Record<string, unknown>>                       // service-param values
  readonly inputs: Readonly<Record<string, Readonly<Record<string, unknown>>>> // input → its connection-param values
}

// Base service node — structure + the handler slot. NOT runnable on its own:
// running requires a target's environment knowledge, supplied by a subclass.
interface ServiceNode<D, P> extends NodeBase {
  readonly kind: "service"
  readonly inputs: D
  readonly params: P
  invoke(deps: HydratedDeps<D>, ctx: Values<P>): unknown   // renamed from run(deps, ctx)
}

configOf(root: ServiceNode): readonly ConfigDeclaration[]          // the shape (unchanged)
buildConfig(root: ServiceNode, sources): Config                    // deploy: graph outputs + defaults → typed Config
hydrate(root: ServiceNode, config: Config): Promise<HydratedDeps>  // boot: per-input connection.hydrate
// (runHost DELETED; ConfigAdapter / ConfigRequest / the string get() DELETED)
```

### Target pack

```ts
// Phased per-service SPI. serialize replaces the string-writing writeConfig;
// package prints the bootstrap and assembles; deploy consumes the artifact.
interface ServiceLowering {
  provision(ctx): Effect<LoweredNode>                              // the App (identity), no code
  serialize(ctx, provisioned, config: Config): Effect<void>        // typed Config → env writes (refs)
  package(ctx, input: { bundle: Bundle; address: string }): Effect<Artifact>  // prints bootstrap + envelope
  deploy(ctx, provisioned, artifact: Artifact): Effect<LoweredNode> // ship + run; environment edge
}

// The pack's runnable node — compute() returns THIS, not a bare core ServiceNode.
class ComputeServiceNode extends ServiceNode {
  async run(address: string, opts?): Promise<unknown> {
    const config = deserialize(configOf(this), readEnv(), address)  // pack codec; the one env read
    return this.invoke(await hydrate(this, config), config.service)
  }
}
```

## The artifact and the boot path

```
main.js                ← app bundle: exports the Service node, core inlined ONCE, inert on import
bootstrap.js           ← pack-printed at deploy: `import main from "./main.js"; await main.run("<address>")`
compute.manifest.json  ← pack-written envelope: entrypoint = bootstrap.js
```

- `main.ts` is a pure re-export: `export { default } from "./service"`. Nothing
  runs on import (invariant 3 now reaches the artifact).
- `.run` lives on the node (pack authoring entry), inlined into the bundle by the
  app's own bundler — **one** copy of core in the artifact; the bootstrap carries
  zero core and one import.
- Boot: `main.run(address)` → deserialize env (pack) → hydrate (core) →
  `.invoke` (core). The bootstrap needs no graph: the heavy walk happened at
  deploy; only the address survives into the artifact.
- Deterministic bytes (bundle from the app, bootstrap from the address) → an
  unchanged service hashes identically → noop redeploy. `package` must fix tar
  mtimes/ordering.

## The deploy path (core sequencing, edges not order)

application.provision (Project + poison DATABASE_URL/_POOLED) once. Then per
service in topological order over the connection edges:

1. lower resource inputs (`resources[type]`) → outputs (e.g. `{ url }`).
2. `provision` → the App (identity).
3. core **builds the typed Config**: each input's params matched by name to the
   lowered producer/resource outputs — resource params from the resource
   lowering, connection-end params from the **producer's deploy outputs** (the
   producer is already fully deployed in topo order; its URL is real, PRO-200) —
   plus service-param defaults. Leaf values are provisioning refs.
4. `serialize(config)` → one env write per leaf, value = the ref. The refs are
   what make the env vars depend on the resources/producer (the edges).
5. `package({ bundle, address })` → the pack prints the bootstrap (address baked)
   and assembles the artifact.
6. `deploy(artifact)` → the version. Its `environment` prop consumes serialize's
   env writes, so the version depends on them: the first version boots with a
   complete env. This is the PRO-211 race killed by construction, and the same
   edge propagates change (a producer's new URL diffs the consumer's Deployment
   → new version).

## What dies

- `runHost` (core) — folded into the pack node's `.run`.
- `@makerkit/core/runtime` as a public entry — dissolves; the boot loop is the
  pack's.
- `ConfigAdapter` (`get` → strings, `describe`) and core-side coercion —
  replaced by core's typed `Config` + the pack's serialize/deserialize.
- `ConfigRequest`, `ResolvedParam { value: string }` — core deals in the typed
  Config, never strings.
- The reserved service-identity variable — already dead; identity is the address.
- `ServiceNode.run(deps, ctx)` — renamed `.invoke`; `.run` now means "boot me".

## R3 consistency (checked, not lost)

R3 gave core config management for **visibility and interception**. Visibility
survives intact: `configOf` still enumerates the shape without booting. What
moves to the pack is only **encoding** — how a typed value becomes a string and
back — which the pack always owned in spirit (the old adapter's private
mapping). Validation ("is this present and the right type") moves with encoding,
because it *is* the pack reversing its own serialization; core still defines the
shape that validation is against. The interception point becomes the typed
Config boundary (core builds it; a harness can inspect/redact it by the `secret`
flag on the shape) plus the DI test path below.

## Test story

The clean local test bypasses config entirely — inject typed fakes and call the
handler: `node.invoke(fakes, { port: 0 })`. That is the dependency inversion the
model promises; no environment, no cloud, no pack. Config round-trip is proven
separately at the pack level (serialize→deserialize identity) and end to end by
the deploy proof.

## Rejected alternatives (so we don't relitigate)

- **Identity via a reserved env variable** — impossible; project-shared env,
  last write wins (the blocker that started this).
- **User-supplied node id** — collides across registry hexes; identity must be
  framework-assigned from position.
- **Push mechanisms** (codegen / bundler define / virtual module — makerkit
  feeding the app build) — all make makerkit touch the build; rejected for the
  pull-free artifact approach.
- **Bundle imports the app hex (pull)** — forced an interface/implementation file
  split and an inverted grammar (hex declares the ports, service imports them
  back down); judged unintuitive. Services stay one-file and self-describing.
- **runHost inlined into the bootstrap** — put a second copy of core in the
  artifact; collapsed by moving `.run` onto the node so the bundle carries the
  runtime once.
- **Core keeps config encoding/validation** — core would have to know platform
  key formats and string coercion; the pack owns encoding, so it owns both.
```
