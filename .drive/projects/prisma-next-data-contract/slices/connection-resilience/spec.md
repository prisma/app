# Slice 3 spec — connection resilience for the cloud postgres primitives

**Linear:** TML-3013 · **Motivated by:** FT-5226 (PPg cold-start) · **Builds on:** slice 2 (`withConnectionRetry`, the app-cloud-local tracked-resource + provider-merge infra)

## Outcome

The cloud postgres primitives survive PPg's cold-start: the deploy warms the DB (both primitives), and the `pnPostgres` runtime client retries a cold first-connect. Proven live on both examples.

## Changes

1. **Warm-on-provision.** After the DB is provisioned, an apply-time step connects with `withConnectionRetry` + `select 1` so the DB is warm by deploy-end.
   - **Bare `postgres()`**: genuinely new — it does no deploy-time connect today. Add a small app-cloud-local tracked "warm" resource (reuse the `PnMigration` provider-merge pattern; `pg` directly, deploy-only) to `postgresLowering`.
   - **`pnPostgres`**: the migration's `withConnectionRetry` already warms it. Don't double-connect — either share the warm step or leave the migration as the warm point. Implementer's call; note it.
2. **`pnPostgres` runtime client connect-retry.** In `buildClient` (`prisma-next.ts`), make the framework-constructed PN client retry a cold first-connect (and post-scale-to-zero). Investigate the PN runtime's retry/pool hooks; if none, wrap the client's connect/query. Bounded retry; real query errors surface immediately.

## Non-goals

- Bare `postgres()` **runtime** resilience — ADR-0015 binding is `{ url }`, app owns the client; stays app-side (storefront-auth already carries the FT-5219 guards). Warm-on-provision only covers the immediate post-deploy window, not steady-state.
- Changing ADR-0015 / giving bare postgres a client binding.

## DoD

- [ ] Bare `postgres()` deploy warms the DB (storefront E2E still green, now exercising the warm step).
- [ ] `pnPostgres` deploy warms + migrates (pn-widgets E2E still green).
- [ ] `pnPostgres` runtime client retries a cold first-connect (unit-proven; ideally shown live).
- [ ] Index isolation holds (warm/pg machinery deploy-only where applicable; the client-retry is runtime but adds no new heavy import).
- [ ] Full gate green; both live E2E deploys green.

## Dispatches

- **D1 — warm-on-provision** (both lowerings; new tracked warm resource for bare postgres).
- **D2 — pnPostgres client connect-retry** (`buildClient`).
