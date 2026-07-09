# Slice R8 — Prisma-hosted Alchemy state store

## At a glance

```ts
// @makerkit/prisma-alchemy/state — the hosted StateService Layer
export const prismaState = (opts: { workspaceId: string }): AlchemyStateLayer
// bootstrap (automatic, per run): find-or-create workspace project "makerkit-state"
// → its default database → mint a fresh connection (endpoints.direct) → migrate
// schema if absent → acquire session advisory lock for (stack, stage) → serve.

// @makerkit/core/deploy — the target may supply a default state backend
interface Target { /* … */ readonly state?: () => AlchemyStateLayer }
// lower(): state: opts.state ?? target.state?.() ?? localState()

// @makerkit/prisma-cloud/target — hosted state is the default for this target
prismaCloud({ workspaceId })  // now carries state: () => prismaState({ workspaceId })
```

Deploy state moves from local `.alchemy/` files to a workspace-scoped Prisma
Postgres store. Any machine with `PRISMA_SERVICE_TOKEN` + the workspace id
deploys the same stack without duplicating it; concurrent deploys of one
stack/stage fail fast on a lock.

## Chosen design

[`design-note.md`](design-note.md) — reviewed with the operator, all items
settled. In brief: a `StateService` implementation (alchemy's 12-method
interface, `alchemy@2.0.0-beta.59`) in a new `@makerkit/prisma-alchemy/state`
entry, speaking Postgres directly via **postgres.js** to two tables
(`alchemy_resource_state` keyed `(stack, stage, fqn)`, `alchemy_stack_output`
keyed `(stack, stage)`), values through alchemy's own `encodeState` /
`reviveStateRecursive`. Automatic bootstrap through the Management API (reuses
`client.ts`/`credentials.ts`). Session-scoped `pg_try_advisory_lock` on a
reserved connection = the deploy-long lease; crash releases it via connection
drop; contention is a loud, immediate error. Core gains the optional
`Target.state` seam; the pack defaults to hosted state; explicit `opts.state`
wins. Plaintext JSONB by explicit decision (secrets-in-state is a separate
deferred item). No back-compat/migration machinery — this is a PoC; the
standing demo is destroyed and redeployed once.

Deviations amend the design note (and `layering.md` if structural) with the
operator first.

## Coherence rationale

One PR: the store, the seam, the default, proven live. One reviewer can hold
it: ~1 package entry (store + bootstrap + lock), a 2-line core seam, a 1-line
pack change, tests, and the deploy proof. Rollback is one unit (revert →
localState default returns).

## Scope

**In:**
- **`@makerkit/prisma-alchemy/state`** (new subpath export): `prismaState()`
  Layer — StateService impl, schema migration (`create table if not exists`),
  bootstrap (find-or-create `makerkit-state` project → default DB → fresh
  connection per run), advisory-lock acquire/release on the Layer's scope,
  loud contention error naming stack/stage. postgres.js dependency (deploy-side
  only; no Bun coupling).
- **`@makerkit/core/deploy`**: optional `state?: () => AlchemyStateLayer` on
  `Target`; `lower()` resolution order `opts.state ?? target.state?.() ??
  localState()`.
- **`@makerkit/prisma-cloud/target`**: `prismaCloud()` supplies
  `state: () => prismaState({ workspaceId })`.
- **Tests**: store unit tests against a real local Postgres (CI service
  container or testcontainer; PGlite acceptable if advisory locks are
  supported — verify, else real PG), covering the 12 methods round-trip,
  encode/revive fidelity (Redacted marker), lock contention + release,
  idempotent migration. Core seam test (target default vs opts override).
- **E2E / proof**: deploy `examples/storefront-auth` with hosted state (round
  trip live); second fresh workdir (no `.alchemy/`) redeploys same stack →
  zero duplicates (no-op plan on deterministic nodes); lock contention check;
  destroy leaves the state project intact. Decide and pin the CI e2e's state
  explicitly (unique stack names make hosted state safe there; keep it hosted
  unless it fights the ephemeral flow, then pin `localState()` with a comment).
- **Docs**: `layering.md` Step 1 marked shipped-interim (client-side store);
  the Management API ask filed on Linear (implement alchemy `StateApi` v5,
  bearer → workspace RBAC) and linked from `plan.md`.

**Out (deliberately):**
- Any Management API / platform-side implementation (the filed ask).
- Secrets-in-state changes (deferred item stands).
- `makerkit state sync` or any CLI surface (CLI track owns command surface);
  local→hosted migration is `syncState` in a script if needed at all.
- Encryption of state values beyond PPg at-rest.
- `ALCHEMY_PASSWORD` cleanup (vestigial in alchemy v2 — separate direct change).
- Multi-workspace/team RBAC semantics — the store's access model is "holds a
  valid service token for the workspace", full stop.

## Pre-investigated edge cases

| Edge | What we already know |
| --- | --- |
| Connection DSN | `endpoints.direct.connectionString`, never `url`/top-level (PRO-212). Mint fresh per run — DSN is write-only on read. |
| Default database | Project create auto-provisions it; creating another default 409s (FT-5220). Use the default, create nothing. |
| Find-or-create race | Two first-ever deployers can double-create `makerkit-state`. On create failure, re-list and adopt by name; document the residual. |
| Lock scope | Session (not transaction) advisory lock — transaction scope releases at first commit; the deploy spans many. Reserved connection held for the run. |
| Scale-to-zero idle close | PPg closes idle direct connections (FT-5219 class). The state store's pool must reconnect-on-demand; the *lock* connection dying mid-deploy loses the lease — acceptable for PoC, but detect and fail loudly rather than continue unlocked. |
| Value fidelity | Persist via alchemy's `encodeState`, revive via `reviveStateRecursive` — `Redacted`/`Duration` markers must round-trip byte-identically or resource diffs go haywire. |

## Slice DoD

The fresh-workdir redeploy proof: deploy storefront-auth from workdir A, then
from workdir B with no local state → zero duplicate resources, round trip
live, lock contention fails loudly, destroy clean with the state project
surviving. Plus the inherited floor (typecheck/test/lint/lint:casts green,
Opus review, DCO).

## Open questions

None — design settled with the operator 2026-07-09.

## References

- [`design-note.md`](design-note.md) — the settled design + alchemy source findings.
- [`layering.md`](../../../../docs/design/03-domain-model/layering.md) — the provisioning-state spectrum this ships Step 1 of.
- `alchemy@2.0.0-beta.59` — `src/State/State.ts` (interface), `StateEncoding.ts` (markers), `HttpStateApi.ts` (the v5 API the platform ask targets), `Sync.ts` (`syncState`).
- [`client.ts`](../../../../packages/prisma-alchemy/src/client.ts) / [`credentials.ts`](../../../../packages/prisma-alchemy/src/credentials.ts) — the Management API plumbing bootstrap reuses.
- PRO-212, FT-5220, FT-5219 — the platform gotchas the edge cases encode.
