# ADR-0040: The `prisma-next` binding carries the raw URL and a lazy client

## Decision

`pnPostgres(contract)`'s dependency end hydrates to a two-field binding
instead of the bare typed client:

```ts
const { db } = service.load();

db.url;    // the raw connection string — exactly what plain postgres() delivers
db.client; // the typed Prisma Next client — constructed on FIRST access, memoized
```

`url` is the wire value the connection already carries. `client` is a lazy
memoized accessor over today's client construction; `hydrate` itself no longer
constructs anything. The exported binding type is
`PnPostgresBinding<C> = { readonly url: string; readonly client: Client<C> }`.

Everything else about the edge is unchanged: the dependency still names the
contract, `satisfies` still compares storage hashes, and the deploy still
migrates the database to the contract's ref before dependent services start
(ADR-0022).

## Reasoning

**A contract-migrated database and a framework-built client are separate
wants.** The first external port (open-chat) owns its database client — one
`pg.Pool` built from a raw URL, shared with a third-party library that is not
a Prisma Next consumer. It still wants framework-run migrations. With the
binding equal to the typed client, "migrations + my own client" was
inexpressible: the app was pushed to plain `postgres()` and an out-of-band,
by-hand schema step against a URL the framework resolves but never surfaces.
Carrying `url` in the binding dissolves that: the PN binding becomes a strict
superset of `postgres()`'s `{ url }`.

**The contract stays the interface; the client was never the interface.** The
"data contracts are the interface for data resources" principle governs
whether a resource may plug into a dependency — the hash comparison — not
which client reads the data afterwards. Plain `postgres()` already treats the
raw URL as a first-class binding value; this ADR extends the same courtesy to
contract-carrying edges without weakening the compatibility check.

**Eager construction charged consumers for a client they may never use — and
made one bad input poison all of them.** The Prisma Next runtime deserializes
and structurally validates `contractJson` at construction (its pool is lazy;
its validation is not), and `hydrateSync` hydrates every input in one pass.
So a consumer that only wanted the URL still paid validation, and a
version-skewed contract crashed the whole `load()` — the service couldn't
read even its unrelated inputs, and the error named no input. Lazy
construction moves the cost and the failure to the first `client` access,
attributed to that access, and a URL-only consumer never triggers it.

**Laziness here is not exotic.** The runtime already advertises lazy driver
instantiation; the framework's own `origin()` (ADR-0039) raises its
missing-config error lazily at the call for the same reason — services that
never read a value are unaffected by its absence or invalidity.

## Consequences

1. Binding shape change for existing `pnPostgres(contract)` consumers:
   `db.orm.…` becomes `db.client.orm.…` (mechanical; the full client surface
   — `sql`, `transaction`, `close`, … — remains reachable under `client`).
2. A contract too new or too old for the installed runtime no longer fails at
   `load()`; it fails at first `client` access. URL-only consumers run
   against schemas the runtime's validator would reject — the contract hash
   check at provision remains the compatibility check that matters
   (ADR-0022).
3. `PnMigration` and the deploy lowering are untouched: provisioning
   `pnPostgres({ name, contract, config })` still migrates at deploy. An app
   owning its client gets framework-run migrations with no operator step.
4. The cross-kind alternative (letting a `'prisma-next'` resource satisfy a
   plain `'postgres'` dependency) is not pursued: it weakens kind identity to
   solve a problem the binding can carry on its own.

## Alternatives considered

- **Cross-kind `satisfies`** — widen `Contract` so `'prisma-next'` satisfies
  `'postgres'`. Touches core's kind model to express what is really a binding
  concern; a naive hash-absent rule would let a PN resource satisfy unrelated
  kinds. Rejected.
- **`{ url, orm }` (orm only, no full client)** — loses `sql`, `transaction`,
  `close`, and future client surface for no gain. Rejected.
- **Keep the client eager, add `url` beside it** — retains the validation tax
  and the poisoned-`load()` failure mode for URL-only consumers; the
  motivating consumer would crash at boot on its version-skewed contract.
  Rejected.
