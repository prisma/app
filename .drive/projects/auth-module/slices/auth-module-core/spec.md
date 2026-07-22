# Slice S1: auth-module-core — spec

> The contract for this slice is the project spec
> (`.drive/projects/auth-module/spec.md`) — it is deliberately exhaustive
> and this file does not restate it. This file records slice boundaries and
> DoD only. Linear: TML-3076.

## At a glance

`@internal/auth` exists and deploys: email+password auth, sessions,
JWT/JWKS, `session` + `admin` rpc ports, `jwtVerifier()`, `authProxy()`,
minted instance secret, the `auth` extension pack, pack preflight +
multi-space migrate passthrough in the target, local testing export, and
`examples/auth` deployed smoke.

## Coherence rationale

One reviewer sitting: "the auth module exists end to end, minus email."
Big by line count (email's precedent: one +5k PR) but a single rollback
unit — nothing in it is useful in isolation, and no intermediate state is
deployable. Email flows (S2), the consumer example (S3), and embedded
(S4) are the independently-valuable follow-ons.

## Scope

**In:** everything in the project spec EXCEPT the items below. Includes all
four target changes, the pack (per spec Open question 1's interim
decision: our own pack, packId/hash + schema name behind single
constants), the full package, `examples/auth`, public re-exports, README
(sections that exist without email), depcruise/planes/exports-map config.

**Deliberately out:** `templates.ts` + real send callbacks +
`requireEmailVerification: true` (S2); `email` boundary dep on
factory/service (S2); `examples/storefront-auth` (S3); `./embedded` (S4);
README sections for email flows, embedded, SPA alternative.

## Pre-investigated edge cases

- `user` is a Postgres reserved word — quote `auth."user"` everywhere
  (spec § Store).
- The exports-entrypoints rule's multi-pass exception list must gain
  `auth`, or `rules` lint clobbers the hand-maintained exports map.
- Compose's `runMigration` noop shortcut skips extension spaces — the
  multi-space passthrough must not return `noop` when packs are present
  (spec § Target changes item 4).
- Better Auth `1.x` `advanced.database.generateId` semantics changed
  across minor versions — verify against the pinned version; ids must be
  `text` (spec § auth-options; record and ask if the pinned default
  conflicts).

## Slice DoD

- `examples/auth` deploys to real Prisma Cloud and `scripts/smoke.ts`
  passes (signup → login → token → verified `/me` → getSession →
  revokeUserSessions → getSession null).
- `startLocalAuthServer` integration suite passes with no cloud
  credentials.
- Schema-conformance test passes (pack ↔ Better Auth generator ↔
  schema.sql).

(CI-green, reviewer-accept, and project-DoD floor inherited.)

## Open questions

None beyond project spec Open question 1 (interim decision recorded
there; S1 proceeds on the fallback).
