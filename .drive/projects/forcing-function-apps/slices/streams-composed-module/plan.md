# Dispatch plan: streams-composed-module

Five dispatches, sandwich shape: scoping spike (D1) → module package (D2) →
deploy example + deployed proof (D3) → README (D4) → PR (D5). Sequential.

Contract source: [spec.md](spec.md). Do not re-derive the design; implement it.

> Process note: D1–D2 were executed before this slice was formally entered
> into the Drive process (operator correction 2026-07-15); they are recorded
> here retroactively with their evidence. D3 onward run through the normal
> dispatch loop.

---

## D1 — Scoping spike ✅ (done 2026-07-15)

**Outcome:** the module's config surface, secret, contract exposure, and
internals are decided and recorded.

**Evidence:** `packages/1-prisma-cloud/2-shared-modules/streams/SCOPE.md`,
committed on `claude/streams-compose-module-07aefb`. Key findings: the
server's SigV4 client uses exactly storage's S3 subset; `{ url }` binding
needs no new lowering; conformance suite reachable via `CONFORMANCE_TEST_URL`
but has no auth option.

**Hands to:** SCOPE.md as the design contract for D2.

## D2 — Module package + local proof ✅ (done 2026-07-15)

**Outcome:** `@internal/streams` exists mirroring storage's shape; umbrella
re-exports it; the local stand-in passes conformance with no cloud creds.

**Evidence** (commit `feat(streams): durable event streams as a composed
module`, pushed to `bot/claude/streams-compose-module-07aefb`):
- 12/12 `bun test src` including an end-to-end integration test: real
  entrypoint process against the storage stand-in over throwaway Postgres —
  bearer auth, append, read-from-offset, long-poll, SSE tail,
  segment+manifest upload into storage, cold-start restore from the store.
- 239/239 local conformance (`pnpm test:conformance:local`).
- Repo checks green: typecheck, `pnpm lint`, `pnpm lint:deps`, umbrella build;
  entrypoint bundle verified single-file (1.5 MB) and boots to the config
  read under bun.

**Hands to:** built module + deployed-conformance harness
(`vitest.conformance.deployed.config.ts`) ready for a real deploy.

## D3 — Deploy example + deployed proof ✅ (done 2026-07-15)

**Outcome:** `examples/streams` (smoke/storage-example pattern) deploys the
module to real Prisma Cloud — root module provisions `storage()` + `streams()`
wired together, `envSecret` binds the bearer key — and the deployed URL
passes the conformance suite (bearer fetch wrapper) plus a consumer smoke
(append, read from offset, SSE tail, long-poll). Cold-start
bootstrap-from-store and segment upload to the storage module observed on the
deployment (version logs + object listing).

**Builds on:** D2's built module and deployed-conformance harness.
**Hands to:** a live-verified module; deploy runbook facts for the README.

**Completed when:**
- `pnpm deploy` in `examples/streams` (creds via
  `PRISMA_DEPLOY_ENV=~/.config/prisma-compose/deploy.env`) succeeds.
- `pnpm test:conformance:deployed` green against the deployed URL.
- Consumer smoke green against the deployed URL.
- Bootstrap-from-store verified: restart/redeploy path serves pre-restart
  events; storage module contains segments + manifest.
- Deployment destroyed or left per operator instruction; example is
  CI-runnable locally (integration test against the stand-in).

## D4 — README ✅ (done 2026-07-15)

**Outcome:** `packages/1-prisma-cloud/2-shared-modules/streams/README.md`
documents contract scope, wiring example (storage dependency + bearer-key
secret + consumer), and local dev — storage-README register.

**Builds on:** D3 (wiring facts proven live).
**Hands to:** reviewable docs for the PR.

**Completed when:** README covers contract scope / wiring / local dev; lint
green.

## D5 — PR open ✅ (done 2026-07-15)

**Outcome:** one PR for the slice on `claude/streams-compose-module-07aefb`,
title/body from `references/pr-description.md`, technical content only (no
strategy rationale — public repo).

**Builds on:** D1–D4 all landed on the branch.
**Hands to:** review URL returned to the operator; slice enters review.

**Completed when:** PR open with drafted body; CI green or failures triaged.

## D6 — Merge readiness (added post-plan) ✅ (done 2026-07-15)

**Outcome:** branch rebased onto main across three breaking changes (Composer
rename, COMPOSER_ env prefix, storage's dropped service.mjs workaround), full
verification re-run green, PR #84 squash-merged with operator approval.
