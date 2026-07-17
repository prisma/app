# S2 — Dispatch plan

## D1 — Failing tests

**Outcome:** the four Slice-DoD cases exist in `lowering.test.ts`; cases
1 fails (no guard yet), 2–4 pass (pinning the exemptions before the guard
lands).
**Builds on:** S1 merged.
**Hands to:** D2 — an executable contract for the guard.
**Completed when:** test run shows exactly case 1 red.

## D2 — Implement the guard

**Outcome:** the spec's guard clause + proxy-fact comment in `buildConfig`;
all four cases green; dogfood/example lowering tests still green (any
newly-exposed under-delivery fixed as its own commit, named in the PR body).
**Builds on:** D1.
**Hands to:** slice PR open.
**Completed when:** full CI green.
