# ADR-0015: Dependencies resolve to bindings; clients are constructed app-side

## Status

Accepted

## Decision

`service.load()` returns each dependency's **binding** — the most-derived value
the dependency's contract alone can construct — never a user-supplied client.
A dependency declaration is pure requirement: it names a contract and carries no
client factory.

Two cases follow from "what the contract alone can construct":

- A kind whose **protocol the framework owns** (rpc, http) derives a **client** as
  its binding: the contract plus our transport plus a runtime built-in, with no
  driver to choose. `rpc(contract)` binds to a typed generated client;
  `http()` binds to a thin fetch wrapper.
- A **resource kind** (postgres) binds to its **typed connection config** —
  `PostgresConfig`, i.e. `{ url }`. The app constructs its own client from that
  config, with its own driver, in app code.

So `postgres()` (no arguments) is the dependency; `postgres({ name })` stays the
provisionable identity. `http()` no longer accepts a client override. The
framework stops constructing clients it cannot choose.

## Reasoning

Start with what an app writes to depend on a database, and what it then does
with the result:

```ts
// service.ts — pure requirement, no driver, no factory
export default compute({
  deps: { db: postgres(), auth: rpc(authContract) },
  build: node({ module: import.meta.url, entry: "../dist/server.js" }),
});

// server.ts — the app's own entry constructs and owns its client
const { db, auth } = service.load();     // db: PostgresConfig; auth: a typed rpc client
export const sql = new SQL({ url: db.url, max: 1, idleTimeout: 10 });
```

The interesting asymmetry is in that second line: `auth` comes back ready to
call, but `db` comes back as `{ url }` and the app builds the client itself.
That asymmetry is not an inconsistency — it is exactly what "the contract alone
can construct" means, and it is the whole decision.

For `rpc` and `http`, the framework owns the protocol. An rpc contract plus our
network binding fully determines the client; there is no driver to pick, so the
most-derived thing the contract can produce *is* the client, and producing it is
the framework's job. Nothing is lost by handing the app a ready client, because
there was never a choice to place.

Postgres is different. Its wire protocol is not ours, and the client is a driver
— `bun:sql`, `node-postgres`, `postgrejs`, a pool with specific options — whose
**type is the choice**. A client factory in the declaration (`postgres({ client
})`, which earlier iterations shipped) conflates two separate things: *what the
service requires* (a Postgres speaking this contract) and *how this app consumes
it* (this driver, these pool settings). The requirement is provider-independent;
the consumption is an app decision. Folding the second into the first means the
declaration — the thing the system wires against — carries app-specific mechanics it
has no business knowing, and the pack is pushed toward blessing or shipping a
driver it cannot choose correctly for every app.

The resolution is to give the declaration only what is irreducibly shared — the
typed config the contract describes — and let the driver choice be *placed*
where it honestly lives: in app code, next to the app's other runtime choices.
`load()` hands over `PostgresConfig`; the app writes `new SQL({ url: db.url })`.
Because that construction never touches the dependency's contract, it cannot
change which providers wire — provider-independence stays a structural property,
not a convention the app must be careful to preserve.

The invariants the client-in-declaration form was protecting all survive. **DI
is still typed**: the binding is typed by the contract (`PostgresConfig` for
postgres, `Client<C>` for rpc), so the app entry gets full type information.
**The entry is still wiring-free** in the sense that matters: it never reads the
environment, a key name, or the topology — `load()` hands it the binding and it
goes. **Memoization** becomes trivially app-owned: the client is a module-level
`export const`, one per process, instead of something the framework had to cache
on the node. The framework simply stops doing the one thing it could not do well
— choosing a client it has no basis to choose.

**Stipulating a specific driver presentation** — when a consumer wants, say, a
particular pool wrapper — is a plain `binding → client` function applied in app
code (`const sql = bunSql(db)`). It is structurally validity-preserving: it
takes the binding and returns a client, never touching the requirement's
contract, so it cannot affect wiring. There is nothing for the framework to
model here; it is ordinary app code.

## Consequences

- **A postgres dependency's `load()` value is `PostgresConfig`, not a client.**
  App code constructs the client — one `new SQL(...)` (or the app's driver of
  choice) at module scope. This is the visible change for app authors.
- **`load()`'s return type is mixed by design**: a derived client for
  protocol-owned kinds (rpc, http), a typed config for resource kinds
  (postgres). The rule that makes it coherent is uniform — "the most-derived
  thing the contract can construct" — even though the results differ in shape.
  Docs must state this honestly rather than promise "typed clients".
- **The pack ships no driver and blesses none.** `@prisma/app-cloud` has no
  `bun`/`pg` dependency and makes no client for postgres; the runtime-agnostic
  and driver-free invariants hold without an exception.
- **`http()` no longer takes a client override.** It always derives its fetch
  wrapper. This trades a rarely-used escape hatch for one uniform rule (no user
  client in any declaration); an app that needs a different http client wraps
  the binding app-side, the same as postgres.
- **The declaration shrinks toward pure requirement.** With the client gone, a
  `DependencyEnd` is `{ name?, required, connection: { params, hydrate } }` where
  `hydrate` is now either a pack-derived client (rpc/http) or the identity
  (postgres). This sets up a further simplification recorded as direction below.

## Direction (recorded, not built here)

The natural next step is for the **contract to own the config surface**: the
binding type becomes the contract's `Cmp`, and `DependencyEnd` shrinks toward
`{ name, required }` with `params`/`hydrate` moving off the end and onto the
contract. That is a larger reshape, out of scope for this decision; recorded so
the shape of `DependencyEnd` here is understood as transitional.

## Alternatives considered

- **A client factory in the declaration** (`postgres({ client })`, the shipped
  interim). Rejected: it conflates requirement with consumption mechanics, and
  the driver choice is irreducible — a postgres client's type *is* the choice,
  so it can only be placed, and app code is its honest home. The same objection
  rejects **named adapters in the declaration** (`postgres({ driver: bunSql })`):
  keeping any stipulation out of `deps` is precisely what makes
  provider-independence structural rather than conventional.
- **A `clients` map on the service** (`compute({ deps, clients: { db: bunSql }
  })`). Validity-preserving (the wrap is applied after binding, never touching
  the contract) and typed — but machinery we do not need yet. Recorded as a
  **compatible future extension**: it layers onto the same hydrate slot without
  changing the binding model, and can be added if the app-side wrap proves
  noisy in practice.
- **Binding at `load()` / bind-time** (factories passed per `load()` call, or via
  a `service.bind(factories)`). Rejected: `load()` is called from multiple sites
  — every Next page, `serve()` — so per-call factories are either duplicated
  across those sites or order-dependent on a first "binding" call. The binding
  must be determined by the declaration, resolved once.
- **The system supplies the client.** Infeasible: the client factory must ship
  in the *consumer's* deployed bundle (it runs at that service's boot), and
  system wiring code does not travel into a service's bundle.
- **A kind-derived client for postgres** (the pack ships or blesses a driver, as
  it legitimately does for http). Rejected: unlike http, postgres's protocol is
  not ours and no single driver pick is right for every app — the client's type
  is the app's choice, so deriving one would violate the driver-free pack
  invariant and impose a decision the pack cannot make correctly.

## Related

- [`../10-domains/core-model.md`](../10-domains/core-model.md) — `load()` and the
  runtime path; the binding is what `load()` returns.
- [`ADR-0013`](ADR-0013-resources-are-provisioned-by-systems-deps-are-declarations.md)
  — the uniform dependency model; its "client coupling accepted for now"
  consequence is resolved here.
- [`connection-contracts.md`](../10-domains/connection-contracts.md) — the
  Contract that types each binding.
