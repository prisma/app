# Design note — Prisma-hosted Alchemy state store (slice R8)

Status: **settled — operator-reviewed 2026-07-09** (Target.state seam approved;
`makerkit-state` project shape explained and accepted; proof on storefront-auth).
The contract is [`spec.md`](spec.md). Settles the design for the hosted
state store (Step 1 of the provisioning-state spectrum in
[`layering.md`](../../../../docs/design/03-domain-model/layering.md)). Scope
decisions already confirmed by the operator (2026-07-09):

- Pluggable-backend Layer; prove it on direct Prisma Postgres; file the
  Management API ask upstream.
- Bootstrap is **automatic** — no init step, no user-managed state config.
- Locking is a pack-owned affordance; the implementation (a Postgres lock) is
  private to the store.
- Secrets-in-state stays a deferred item; no action in this slice.
- Slice vs project: operator is indifferent; shaped as one slice.

## What Alchemy actually provides (read from `alchemy@2.0.0-beta.59` source)

- **`StateService`** (`alchemy/State/State.ts`): 12 Effect-based methods —
  `id`, `getVersion`, `listStacks`, `listStages`, `get`, `getReplacedResources`,
  `set`, `delete`, `deleteStack`, `list`, `getOutput`, `setOutput`. Resources are
  keyed `{ stack, stage, fqn }`; stack outputs keyed `{ stack, stage }`. Errors
  are `StateStoreError`.
- **No locking anywhere.** Neither the interface nor any built-in store has a
  lease concept. Concurrency control is entirely ours to add inside the Layer.
- **Value encoding is shared and exported**: `encodeState` /
  `reviveStateRecursive` (`alchemy/State/StateEncoding.ts`) handle the
  `Redacted` and `Duration` markers. A custom store reuses them; we write JSON.
- **Secrets are persisted in the clear** by `encodeState` (the `__redacted__`
  marker wraps the *actual* value). Encryption, where it exists, is per-store:
  the Cloudflare state store AES-encrypts value blobs with a key from its own
  secrets store. `ALCHEMY_PASSWORD` appears **nowhere** in the v2 beta source —
  our env plumbing for it looks vestigial (flagged below, out of scope).
- **A versioned HTTP state API ships in the box**: `StateApi`
  (`alchemy/State/HttpStateApi.ts`, `STATE_STORE_VERSION = 5`, bearer-token
  auth) plus a generic `httpStateStore` client. This is the seam the eventual
  Management API implementation targets — the client side already exists.
- **`syncState`** mirrors one store into another — the migration affordance for
  adopting existing local state.
- **Layer requirements**: core's `LowerOptions.state` is
  `Layer.Layer<State, never, StackServices>`; `StackServices` includes
  `Scope`, so the Layer can do scoped acquire/release — exactly what a
  deploy-long lock lease needs.

## Decisions

### D1 — Home: `@makerkit/prisma-alchemy/state`

The store is a Prisma×Alchemy integration, not MakerKit-core (layering.md
already says so). `prisma-alchemy` holds the Management API client and
credentials plumbing (`client.ts`, `credentials.ts`) the bootstrap reuses. New
subpath export `./state`; deploy-machine-only, so heavy imports are fine there
(same rule as the pack's `/target`).

### D2 — Backend: a `StateService` Layer speaking Postgres directly

`prismaState({ workspaceId })` returns the Layer. Storage:

```sql
create table if not exists alchemy_resource_state (
  stack text not null, stage text not null, fqn text not null,
  value jsonb not null, updated_at timestamptz not null default now(),
  primary key (stack, stage, fqn)
);
create table if not exists alchemy_stack_output (
  stack text not null, stage text not null,
  value jsonb not null, updated_at timestamptz not null default now(),
  primary key (stack, stage)
);
```

The 12 methods map 1:1 onto trivial SQL. Values go through Alchemy's own
`encodeState`/`reviveStateRecursive`, so the wire shape matches every other
store. `id: "prisma-postgres"`, `getVersion` returns the
`STATE_STORE_VERSION` the lib was built against (what `localState` does).

Driver: **postgres.js** (`postgres` npm package) — pure-JS, no native deps,
runs under Bun and Node, supports reserved connections (needed for the
advisory-lock session). `@effect/sql-pg` was considered but its beta-version
alignment with `effect@4.0.0-beta.92` is an unnecessary risk for 1:1 SQL.
Bun.SQL is out: a shipped package must not couple to the Bun runtime.

### D3 — Bootstrap: automatic find-or-create, zero user steps

The Layer's init (scoped, once per stack run):

1. Management API, authenticated by the `PRISMA_SERVICE_TOKEN` the deployer
   already needs: find the workspace's reserved state project by name
   (`makerkit-state`), create it if absent.
2. Use the project's **default database** (auto-provisioned at project create —
   FT-5220 means we must not create one).
3. **Mint a fresh connection each run** (`POST /databases/{id}/connections`) and
   read `endpoints.direct.connectionString` (PRO-212). This sidesteps the
   DSN-is-write-only-on-read problem entirely: no DSN is ever stored or shared
   between machines; possession of the service token *is* the credential.
4. `create table if not exists …` (idempotent migration), then serve.

A second machine needs exactly what it already needed to deploy at all: the
service token and workspace id. That is the silky onramp.

Why a dedicated *Project* and not a resource inside the app's own project
(operator question, 2026-07-09): PDP has no workspace-level database — the
hierarchy is Workspace → Project → Database, so the store must live under
*some* project. The app's own project is circular: it is itself a resource
tracked in state (doesn't exist before the first apply; destroyed by the
teardown it must record), and per-app stores fragment `listStacks`,
cross-stack refs, and the fresh-machine bootstrap. A dedicated project outside
user topology is the closest expressible stand-in for the real design
(layering.md: state is ambient platform infrastructure) until the Management
API implements StateApi v5, at which point the visible project disappears.

Known race: two first-ever deployers can double-create the state project.
Mitigation: on create failure/duplicate, re-list and adopt the winner by name;
document the residual (same class of race every find-or-create has).

Connection accumulation (one per run) is real but bounded and invisible to
users; a cleanup pass (delete aged connections at init) is cheap — include it
if the API makes it a one-call listing, else note as follow-up.

### D4 — Locking: session-scoped Postgres advisory lock, fail-fast

On Layer init, on a **reserved connection**:
`pg_try_advisory_lock(hashtextextended('makerkit:' || stack || '/' || stage, 0))`.

- Acquired for the whole stack run; released by scope close, and — the point of
  session (not transaction) scope — **auto-released by Postgres if the deployer
  process dies**, because the connection drops. Lease semantics with no lease
  bookkeeping.
- On contention: fail immediately and loudly ("another deploy holds the state
  lock for stack X stage Y"), never queue silently. A `--wait` affordance can
  come later.
- The affordance lives in our store; alchemy's interface stays untouched. If
  the interface ever grows locking, we migrate; nothing else in MakerKit knows.
- **Per-operation lease re-verification (`checkLive`) — amended to the
  shipped mechanism (2026-07-09, post-review probe).** Every storage call
  reasserts the lease before running, but it never queries the reserved
  connection directly: postgres.js does not transparently reconnect a
  server-killed reserved connection, and querying a dead one throws inside
  postgres.js's deferred write path rather than rejecting cleanly — a risk
  verified with a real `pg_terminate_backend` (FT-5219 class), which could
  crash the deploy process outright. `checkLive` instead captures the
  reserved connection's backend pid at acquire time and asks a *separate
  pool connection* whether that pid still holds the advisory lock, via
  `pg_locks` — never the connection that might already be dead. The check is
  best-effort and not atomic with the operation it guards (the lease could
  theoretically be lost in the gap); that residual is accepted. See
  `lock.ts`'s `checkLive` and `service.ts`'s `guardStateService`.

Answers the operator's "can we use a DB transaction lock?" — yes, in
session-scoped form (transaction scope would release at the first commit;
the deploy spans many).

### D5 — Selection: hosted state becomes the prisma-cloud default

Two options:

- (a) callers pass `state: prismaState(...)` per stack — no core change, but
  every example and the CLI must remember it; forgetting silently reverts to
  local state, which is exactly the duplicate-stack footgun.
- (b) `Target` gains an optional `state?: () => AlchemyStateLayer`; core's
  `lower()` resolves `opts.state ?? target.state?.() ?? localState()`. The pack
  supplies the hosted store as its default; explicit `opts.state` still wins
  (CI's ephemeral runs can keep `localState()` or unique stack names — both
  work).

**Decision: (b), operator-approved.** One optional field on the SPI, one line
in `lower()`, and the smooth-onramp goal is met for every deployer without
per-app wiring. Core stays target-neutral (the field is generic, the pack
supplies the value). No migration machinery: this is a PoC — the standing demo
is destroyed and redeployed once onto hosted state. Coordination note:
`deploy.ts` is also grazed by the CLI track (its bundle handling); this edit
is 2 lines in a different function — trivial rebase either direction.

### D6 — Secrets in state: plaintext JSONB now, by explicit decision

The workspace state DB is credentialed (service-token-gated connection mint)
and PPg encrypts at rest. Client-side AES like the Cloudflare store would
reintroduce the key-distribution problem the bootstrap just eliminated.
Confirmed with operator: avoiding secrets in state is the direction (the
"provisioned credentials → transient platform secret" deferred item), no action
in this slice.

Flag (out of scope): `ALCHEMY_PASSWORD` is generated by `scripts/setup-env.ts`
and CI but nothing in alchemy v2 beta reads it — candidate dead plumbing to
remove separately.

### D7 — The platform ask (filed, not built)

File upstream (Linear, platform surface): implement **alchemy's `StateApi` v5**
(bearer auth → workspace RBAC, `/version` probe) as a Management API surface.
When it exists, deployers switch to the stock `httpStateStore({ url, authToken })`
and D2–D4 collapse into the platform; consumers change nothing (the Layer is
the seam). Our direct-PPg store is the proof and the interim.

### D8 — Adoption/migration

`syncState(localStore, prismaStore)` covers importing existing local state
(the standing demo). A `makerkit state sync` command belongs to the CLI track
later; this slice proves the path with a script or documented one-liner, not a
product surface.

## Proof (slice DoD)

1. **Fresh-clone no-op:** deploy `examples/storefront-auth` with hosted state
   from workdir A (round trip live); delete/absent `.alchemy/` in a second
   workdir B; deploy the same stack name from B → **`Plan: N to noop`**, zero
   duplicates. (This is the exact failure hosted state exists to kill. The
   Next artifact's known non-determinism may re-version the storefront — the
   no-op assertion applies to the deterministic nodes; zero *duplicates* is
   the hard assertion.) Operator accepted the file-conflict risk with the
   parallel CLI track (2026-07-09); rebase over it if it lands first.
2. **Lock:** while A holds a deploy open, B's deploy fails fast with the
   contention error; after A finishes, B succeeds.
3. **Crash-release:** kill a deployer mid-run; a following deploy acquires the
   lock (connection-drop released it).
4. **Destroy** cleans state rows; the state project/database survives (it is
   control-plane, never user topology).
5. Gates: `pnpm typecheck`, `pnpm test` (store unit tests against a local
   Postgres or PGlite), `pnpm lint`, `pnpm lint:casts`. E2E deploy workflow
   stays green (explicitly pinned to `localState()` or unique stack names —
   decided at implementation).

## Boundary with the parallel CLI track

Owns: `packages/prisma-alchemy/src/state/**` (+ its package.json export),
the two-line `Target.state` seam in `packages/makerkit-core/src/deploy.ts` +
`Target` type, docs (`layering.md` status, a short domain doc if warranted),
`plan.md`/spec updates, the Linear ask. Does **not** touch: adapters, examples'
config/build files, `e2e-deploy.yml`, anything in the CLI brief's §6 list.
Residual overlap: `deploy.ts` (different functions) and
`examples/storefront-auth` deploy wiring (the proof target — operator accepted
the conflict risk; rebase over the CLI track if needed).

## Review outcome (2026-07-09)

1. `Target.state` SPI default — **approved**.
2. `makerkit-state` dedicated workspace project — **accepted** (PDP has no
   workspace-level database; the app project is circular — see D3).
3. Proof example — **storefront-auth**, CLI-track conflict risk accepted.
