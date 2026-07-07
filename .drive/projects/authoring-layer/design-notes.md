# Authoring Layer — Design Notes

The design is settled and recorded in the canonical docs — this file does not restate
it, it points to it and records the build-decision history.

## Canonical design (source of truth)

- [`docs/design/10-domains/core-model.md`](../../../docs/design/10-domains/core-model.md)
  — **the build contract**: all types, the six package entries with dependency
  weights, the target-pack contract, the worked prisma-cloud pack, the five enforced
  invariants, extension points.
- [`core-and-targets.md`](../../../docs/design/03-domain-model/core-and-targets.md) —
  thin core / target-pack split; lowering is routing; runtime is a dumb loop.
- [`authoring-surface.md`](../../../docs/design/03-domain-model/authoring-surface.md)
  — the developer-facing narrative (ports, direction-from-position, Load/Hydrate).
- [`architectural-principles.md`](../../../docs/design/01-principles/architectural-principles.md)
  — no-globals, **runtime-agnostic**, no-target-knowledge, wiring-precedes-execution.

## Decision history (chronological)

1. **Descriptors are pure tagged data; hydration is keyed separately** (first build).
   Survives, refined: nodes carry a `type` routing key; the pack's runtime resolves it.
2. **MakerKit does not bundle** (operator correction). Core's `/build` entry was a
   principle violation; the app owns bundling and the artifact envelope.
3. **Core is target-agnostic; lowering is routing** (operator correction). Core's
   `lower()` importing prisma-alchemy was a principle violation; the vocabulary
   (`compute`, `postgres`) moved to a target pack that carries routing metadata.
   KISS shape set by the operator: the pack provides `postgres()` and `compute()`.
4. **Alchemy stays in core** (`@makerkit/core/deploy` imports it): it is the
   target-neutral provisioning engine per layering.md claim 3, not a deployment target.
5. **Runtime-agnostic** (operator principle): no Bun/Node coupling in any shipped
   entry, even type-only. The DB client factory is app-supplied
   (`runtime({ clients })`); `postgres<C>()` lets the app declare its client type.

## Superseded

The first slice-1 build (PR #6 code: core-owned `lower()` → prisma-alchemy, `/build`
bundler, pack-fixed `Bun.SQL` client) — superseded by decisions 2, 3, 5. Its
graph/Load mechanics, no-globals shim boundary, and test discipline (import-split
guard, side-effect-free-import test) carry forward into the rebuild.

6. **Connection primitive design settled** (operator discussion): three execution
   paths — provision / deploy / run — with core the only actor on all three; the
   pack satisfies an SPI ("packs provide the tools, Core utilizes them; the pack
   is never the actor"). Service SPI splits into provision (identity) /
   writeConfig (values into the runtime env, via the pack's one shared name
   mapping) / deploy (build → running version); core's per-service sequencing
   provision → writeConfig → deploy makes the PRO-211 fresh-deploy race
   structurally impossible. Consumers declare `http()` connection ends (hydrate
   to a plain client; typed generated clients deferred to the interface work);
   the minimal `hex()` wires producer → consumer; connection edges must form a
   DAG (address-at-deploy-time wiring; checked at Load). Recorded in
   core-model.md §§ Three execution paths / Lowering / worked instance.

7. **Project = application; DATABASE_URL forbidden and poisoned** (operator
   decisions). One PDP Project per MakerKit application — all services co-locate
   as Apps with their own Databases; the Project is the config-namespace and
   secret-visibility boundary. The platform's default DATABASE_URL/_POOLED are
   never read: MakerKit writes user-level poison values ("" preferred, "-"
   fallback) at project provision so reliance is impossible. Every database URL
   is an explicit per-service variable through writeConfig. The one-project-per-
   service layout of R1–R3 is retired (it was a slice-1 expedient, wrongly
   rationalized). Target SPI gains application.provision (once, before services);
   postgres resource lowering creates a real Database + Connection. Recorded in
   05-prisma-cloud/* and core-model.md.

8. **Deployment identity = graph address, injected via a deploy-generated
   bootstrap** (operator discussion, R4). The R4 spec's reserved-identity-variable
   mechanism was proven impossible from PDP source (every App in a Project boots a
   byte-identical env — a shared "who am I" key is last-write-wins), and
   user-supplied ids were rejected (registry hexes collide). A node's identity is
   its **address** (path of provision ids from the app root, assigned by Load).
   It reaches the VM through the only per-service channel — the artifact: `main.ts`
   becomes a pure re-export of the Service; core generates a zero-dependency
   bootstrap (its prebuilt single-file `/runtime` inlined) that imports the bundle
   and calls `runHost(service, { id: address })`; the pack's new `package` SPI
   (core is the actor) wraps bundle + bootstrap in the target envelope
   (compute.manifest.json + deterministic tar). Amends decision 2: the app owns
   source → bundle only; the artifact envelope was target vocabulary and moves to
   the pack. `LowerOptions` carries bundles, not tars. Alternatives rejected on the
   way: push mechanisms (codegen/define/virtual module — makerkit feeding the app
   build), and bundle-imports-the-hex pull (forced an interface/implementation
   file split and an inverted grammar the operator judged unintuitive; services
   stay one-file and self-describing).
