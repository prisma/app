# S2 `auth-email-flows` — dispatch plan (resume, 2026-07-23)

Slice contract: `spec.md` §§ Templates, Better Auth configuration (S2),
Module factory, Service, Testing export, Examples/auth; `plan.md` § S2;
HANDOFF-S2.md § 5. Resumes from checkpoint `3cf3c26` — do not restart.

## S2-D1 — finish-email-flows (local)

**Outcome:** the WIP checkpoint verified against the spec, architecture
coverage closed, all local validation commands green, and `examples/auth`
carries the email-module wiring with the outbox-readback e2e.

**Contents:** HANDOFF § 5 steps 1–4 (spec verification checklist;
`architecture.config.json` entries for the 3 new files; typecheck + auth
suite + email suite untouched-green + lint + depcruise + casts;
`examples/auth` email wiring incl. outbox-readback local e2e).

**Validation commands:** root `pnpm typecheck`; auth package tests (unit +
integration); email package tests (must be untouched-green); `pnpm lint`;
depcruise; casts check.

**Builds on:** checkpoint `3cf3c26`. **Hands to:** S2-D2 a locally-green
branch.

## S2-D2 — deployed-smoke

**Outcome:** `examples/auth` deployed smoke extended with
`deliveryMode: none` + outbox readback passes on real Prisma Cloud; clean
teardown with resource counts reported.

**Builds on:** S2-D1. **Hands to:** review + PR-open (orchestrator).

## Held by orchestrator (not dispatched)

- README "Email flows" section (docs are orchestrator work).
- Spec amendments for surfaced deviations.
- S2 PR stacked on S1 (base = S1 branch, or main if #163 merged).

## Stop conditions (carried from the brief)

- The local testing server must accept an `EmailSender` built against the
  email module's `startLocalEmailServer` so the outbox-readback path is the
  production path. If `emailSender(...)` cannot hydrate standalone in the
  testing export without a Load graph: STOP and report — do not hand-roll a
  second email client.
- Any spec assumption observed false: STOP and report; the orchestrator
  amends the spec.
