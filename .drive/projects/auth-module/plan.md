# Auth module — project plan

## Summary

Four slices deliver the auth module per `spec.md`. S1 lands the module,
pack, target support, and a deployed smoke example with password auth. S2
wires the email module (blocked on #146 merging). S3 proves the shared-DB
FK golden path on the real consumer example. S4 ships the embedded mode.

**Spec:** `.drive/projects/auth-module/spec.md`

Linear: project "Composer auth module" (Terminal) — S1 [TML-3076], S2
[TML-3077], S3 [TML-3078], S4 [TML-3079].

## Slices

### S1 — `auth-module-core` (TML-3076)

**Outcome:** `@internal/auth` exists and deploys. Email+password signup,
login, logout, sessions, JWTs with JWKS verification, `session` + `admin`
ports, proxy helper, local testing export. `examples/auth` (dedicated DB via
an empty-app-space PN project) deploys to real Prisma Cloud and its smoke
script passes.

**Contents (spec sections):** Package layout · Contracts · Pack (contract,
0001_init, schema.sql, descriptor) · Target changes (all four: `authSecret`
resource, `pnPackRequirement` + satisfies branch, pack preflight,
multi-space migrate passthrough) · Module factory (no `email` dep yet) ·
Service · auth-options (S1 no-op senders, `requireEmailVerification:
false`) · Entrypoint · Store · Proxy · Testing export · `examples/auth` ·
Test plan minus email/S2 and storefront/S3 items · public package
re-exports.

**Coordination check before start:** spec Open question 1 — the
"BetterAuth Extension" Linear project may supply the pack + DB adapter;
the § Pack portion of this slice is on hold until that call is made.

**Builds on:** nothing. **Hands to:** S2/S3/S4 a published module shape
(factory, ports, pack) they extend without changing existing surfaces
(exception: S2 adds the `email` boundary dep — the one sanctioned
shape change, pinned in the spec).

### S2 — `auth-email-flows`

**Unblocked 2026-07-22:** #146 merged to main; branch rebased onto it.
Merged surface verified against the spec's assumptions — one amendment:
`TemplateDef.render` may now be async (react-email support). Auth's
templates stay plain sync functions as pinned (avoids the `.tsx`
precompile deploy caveat); react-email remains an option consumers can
use for their own templates, not ours.

**Outcome:** Verification, password reset, and magic-link emails deliver
through the email module. `requireEmailVerification: true`. Magic-link
login passes e2e locally (link read back from the email module's outbox
port) and deployed. First module-depends-on-module proof.

**Contents:** `templates.ts` + `safeLink`/escaping · real send callbacks +
deterministic idempotency keys · `email` boundary dep on factory + service ·
embedded input gains `email` · `examples/auth` gains the email module
wiring · S2 test-plan items.

**Builds on:** S1. **Hands to:** S3 the complete zero-click auth loop.

### S3 — `auth-consumer-fk`

**Outcome:** `examples/storefront-auth` reworked into the real consumer:
shared database, `Profile.userId → auth:User` FK, signup → verification →
login → magic link → cross-service JWT hop → logout, e2e locally and
deployed. Proves DoD 3 and 4 and the deploy-time pack preflight against a
real multi-space migration.

**Contents:** spec § Examples/storefront-auth · README golden-path wiring
section (written against the working example) · S3 test-plan items.

**Builds on:** S2.

### S4 — `auth-embedded`

**Outcome:** `./embedded` export ships with service-parity integration
tests; README embedded + SPA-alternative sections complete.

**Contents:** spec § Embedded export · parity tests · README remainder.

**Builds on:** S1 (S2's `email` input lands in whichever of S2/S4 merges
second — coordinate at pickup). **Parallel with:** S2, S3.

### ~~S5~~ → branched out: the `wired-egress` project

Will's call (2026-07-23): this outgrew the auth project. Design record
lives at `.drive/projects/wired-egress/` on branch
`claude/wired-egress-project` (spec, design notes, origin/cross-refs).
The superseded local draft remains at `slices/rpc-port-isolation/spec.md`
for history. Open dependency: the S3 sequencing decision (ship the
consumer example on flat dispatch vs wait for wired-egress slice 1) is
taken at S3 pickup, with the platform team's multi-port answer in hand.

## Sequencing

- Stack: S1 → S2 → S3.
- Parallel: S4 alongside S2/S3 once S1 merges.
- S1 starts immediately; nothing in it waits on #146.

## Close-out (required)

- [ ] Verify every Project-DoD item in `spec.md`.
- [ ] Migrate long-lived docs: spec's design content → module README +
      `docs/` (ADR if the pack-requirement/preflight mechanism deserves
      one — decide at close-out); design-notes learnings → gotchas.md
      where operational.
- [ ] Admin-path feedback (design-notes last section) handed to the
      admin-conventions design pass.
- [ ] Strip repo-wide references to `.drive/projects/auth-module/**`.
- [ ] Delete `.drive/projects/auth-module/`.
