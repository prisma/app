# Slice 2 spec — deploy migrate lowering

**Project:** prisma-next-data-contract · **Builds on:** slice 1 (PR #44)

## Outcome

Deploying an app with a `pnPostgres` resource provisions the database **and**
brings it to the contract's `storageHash` by running Prisma Next's authored
migrations — or fails the deploy if it can't. Proven live on Prisma Cloud.

## Design decisions locked (see design-notes)

- **Config-path mechanism:** app-cloud's `pnPostgres({ name, contract, config })`
  resource carries `config` (the `prisma-next.config.ts` path) as a first-class
  field beside `provides`, built by augmenting `resource()`'s frozen node
  (`Object.freeze({ ...resource({...}), config })`; the `[NODE]` brand survives
  the spread). The lowering reads it via a type predicate. No core change; the
  path never touches the contract's `__cmp`.
- **Migrate only, never synthesize.** The deploy runs PN's authored `migrate`
  (or `dbInit` for the first apply) toward the target hash. No `dbUpdate`
  synthesized plans against a deployed DB. `acceptDataLoss` off — destructive
  steps fail the deploy.
- **The migration is an Alchemy resource** so it participates in deploy state:
  diffed on the target `storageHash`, idempotent (unchanged hash → no-op
  redeploy), and a failed apply leaves marker + DB unchanged.
- **Deploy-time only.** `control.ts` may import PN's control client
  (`@prisma-next/postgres/control`); it never enters an app runtime bundle
  (invariant 5 + the index-isolation invariant still hold).

## Scope

**In:**
- `packages/app-cloud/src/prisma-next.ts` — add the `config` field to the
  resource overload + node augmentation + `isPnPostgresResourceNode` predicate
  (exported for the lowering).
- `packages/app-cloud/src/control.ts` — a `nodes['prisma-next']` lowering:
  provision the DB (as `postgres` does) then run the migration as an Alchemy
  resource keyed on the target `storageHash`; read the live marker; `migrate`
  from marker → target; fail on no-path, destructive-without-opt-in, or runner
  error.
- An example app: author a Prisma Next contract + migration, wire `pnPostgres`,
  deploy to Prisma Cloud, round-trip a request through the typed client.
- CI E2E coverage: first deploy (applies), unchanged redeploy (no-op),
  contract-change redeploy (migrates). A no-path deploy fails and leaves the DB
  untouched (test-verified — local is fine for the failure case).

**Out:**
- Multi-contract / contract-space slices (deferred; see design-notes).
- Dev-time apply / `prisma dev` emulation (parked).
- Bare `postgres()` — untouched.

## Slice DoD (+ project DoD conditions this closes)

- [ ] `pnPostgres` resource carries `config`; predicate reads it; slice-1 tests
      still green; index isolation still holds (PN control machinery is
      deploy-only).
- [ ] Local: the lowering's migration step brings a real local Postgres from
      empty → contract hash via PN's control client; re-running with the same
      hash is a no-op; a target hash with no authored path fails and leaves the
      DB unchanged.
- [ ] Live: an example app deploys to Prisma Cloud and a request round-trips
      through the typed client (project DoD #1).
- [ ] Redeploy of the unchanged app is a no-op; a contract change with an
      authored migration migrates the live DB (project DoD #2).
- [ ] No-path deploy fails with a typed error, DB untouched (project DoD #3).
- [ ] Bare-`postgres()` example + tests untouched and green (project DoD #5).

## Open questions

- Extend an existing example (`storefront-auth`) vs a new minimal example. Lean:
  a new minimal `pn-*` example so the bare-`postgres()` example stays as
  untyped-path coverage (project DoD #5).
- How the migration Alchemy resource keys/diffs (target `storageHash` as the
  identity input) and how `migrate` vs `dbInit` is chosen (empty DB / no marker
  → `dbInit`; existing marker → `migrate`). Resolve against the control client
  in the lowering dispatch.

## Dispatch plan

### D1 — resource `config` field + predicate
Add `config` to `pnPostgres({ name, contract, config })`, the node
augmentation, and `isPnPostgresResourceNode`. Slice-1 tests + isolation green.
**Hands to:** a resource node the lowering can read the config path from.

### D2 — the deploy lowering (local-proven)
`nodes['prisma-next']` in `control.ts`: provision DB + migration Alchemy
resource (marker read → migrate/dbInit to hash → fail on no-path/destructive).
Proven against a real local Postgres: empty→hash, no-op re-run, no-path failure.
**Hands to:** a working lowering ready for a live deploy.

### D3 — example + live E2E
A minimal `pnPostgres` example; deploy to Prisma Cloud; round-trip proof;
redeploy no-op + migrate-on-change; wire into CI E2E. Closes project DoD.
**Hands to:** project close-out.
