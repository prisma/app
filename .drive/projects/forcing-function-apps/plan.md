# Forcing-Function Apps — Project Plan

## Summary

Two milestones. **M1 (datahub)** is fully sliced: secrets and the emulated
cron resource System land in the framework while the datahub port proceeds in
parallel, converging on a production cutover. **M2 (open-chat + dev loop)** is
sketched — its slices are firmed at the M1-close health check, where we also
decide whether M2 becomes a successor project instead.

**Spec:** [spec.md](spec.md) · **Design notes:** [design-notes.md](design-notes.md)
· **Tracker:** [Prisma App: Forcing-Function Apps](https://linear.app/prisma-company/project/prisma-app-forcing-function-apps-495e5a5c6a0d)

## External dependencies

- **Publishing pipeline** — makerkit [PR #29](https://github.com/prisma/makerkit/pull/29); blocks S2's "consume published packages" condition.
- **System composition** — branch `claude/makerkit-cli-mvp-34302a` (boundary ports, nesting, forwarding); blocks S3.
- Both are in flight in other sessions; neither blocks S1.

## Milestone 1: datahub on the framework

### S1 — Secrets as bindings ([TML-2998](https://linear.app/prisma-company/issue/TML-2998))

Secret declared as a dependency, resolved to a binding; backing grounded
against the platform surface (Compute env vars vs management-API store) before
the design settles. ADR for the secrets model.

- **Builds on:** nothing.
- **Hands to:** S2 — apps can declare secret inputs and receive typed bindings.

### S2 — datahub port skeleton ([TML-2999](https://linear.app/prisma-company/issue/TML-2999))

datahub deployed via `prisma-app deploy` from its own repo: ingest + web
services, postgres resource, secrets bindings, published/preview packages.
Scheduling unchanged (in-process tick) for this slice.

- **Builds on:** S1; publishing pipeline.
- **Hands to:** S4 — a framework-deployed datahub verified equivalent to the
  current deployment.

### S3 — Cron as an emulated resource System ([TML-3000](https://linear.app/prisma-company/issue/TML-3000))

Scheduler System (compute service + postgres schedule state) invoking target
services via their http/rpc ports, behind an implementation-blind binding
contract. Resource-as-System ADR; contract filed as a platform ask.

- **Builds on:** system-composition landing on main.
- **Hands to:** S4 — a `cron` resource any app can consume.

### S4 — datahub on cron + cutover ([TML-3001](https://linear.app/prisma-company/issue/TML-3001))

`/tick` driven by the cron resource; equivalence verified; the team's real
instance cut over. Closes M1.

- **Builds on:** S2, S3.
- **Hands to:** M2 — port mechanics proven, first emulated resource in
  production.

### Parallelisation

Two independent threads until S4 joins them:

- Thread A: S1 → S2
- Thread B: S3 (starts when composition lands)
- Join: S4

## Milestone 2: open-chat + dev loop (sketch)

Slices below are placeholders, firmed at the M1-close health check (also the
decision point for splitting M2 into a successor project):

- **S5 — Object storage as an emulated resource System** ([TML-3002](https://linear.app/prisma-company/issue/TML-3002)): blob contract, postgres + R2 backings, the swap demonstration.
- **S6 — Streams as a resource** ([TML-3003](https://linear.app/prisma-company/issue/TML-3003)): design pass first (wrapper System vs managed primitive).
- **S7 — open-chat port** ([TML-3004](https://linear.app/prisma-company/issue/TML-3004)): builds on S5, S6 (+ S1, S3 from M1).
- **S8 — The local dev loop** ([TML-3005](https://linear.app/prisma-company/issue/TML-3005)): builds on S7 — deliberately last, after two ports' worth of evidence.

S5 and S6 are parallel; S7 joins them; S8 closes.

## Close-out (required)

- [ ] Verify all acceptance criteria in [spec.md](spec.md) § Project-DoD
- [ ] Migrate long-lived docs into `docs/` (ADRs: secrets, resource-as-System, dev loop; contract specs)
- [ ] Strip repo-wide references to `.drive/projects/forcing-function-apps/**`
- [ ] Delete `.drive/projects/forcing-function-apps/`
