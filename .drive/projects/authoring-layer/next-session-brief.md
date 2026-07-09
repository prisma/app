# Next-session brief — MakerKit authoring layer

You're picking up work on **MakerKit**, the authoring layer for Prisma Cloud:
developers describe services and their typed dependencies in TypeScript, and the
framework deploys them to Prisma Compute + Prisma Postgres. The work runs under the
**Drive process** — a project lives in `.drive/projects/authoring-layer/`.

Start by reading, in this order, then propose a plan to the operator **before writing code**:

1. `.drive/projects/authoring-layer/plan.md` — the roadmap and the source of truth for
   state and deferred work. **Read "Current position" first.**
2. `docs/design/10-domains/core-model.md` — the execution model (service = declarations
   via `compute({deps, build})`; `run(address, boot)` process controller; `load()` typed
   pull-DI; two-piece build adapters `@makerkit/node` / `@makerkit/nextjs`).
3. `docs/design/10-domains/connection-contracts.md` — the typed-contract mechanism.
4. `.cursor/rules/` — repo rules that always apply (esp. `no-bare-casts.mdc`,
   `type-predicates.mdc`, `git-staging.mdc`).
5. `gotchas.md` — real Prisma-product footguns hit while building this.

## Where it stands (2026-07-09)

- **R1–R6 are all merged to `main`.** The last slice, **R6 — typed RPC connection
  contracts**, merged via PR #13.
- **The contract mechanism (R6):** a framework-owned `Contract<Kind, Cmp>` (opaque
  comparison type `Cmp` + a `kind` brand + a runtime `satisfies()`), checked three ways —
  authoring-time TypeScript assignability at the wiring site (the primary check),
  a Load-time `satisfies()` backstop, and per-call input/output validation. The **RPC**
  kind (`packages/makerkit-rpc`) makes assignability correct by building `Cmp` as a
  concrete function map (contravariant input, covariant output). `serve(service, handlers)`
  generates the RPC server and forces handler↔contract exhaustiveness; the consumer's
  `load()` returns a typed client (RPC over HTTP, on Bun). `http()` remains the untyped
  escape hatch. Naming: **"Contract"** is the abstraction; specific kinds are always
  qualified — **"RPC Contract"**, **"Data Contract"** (the prose name tracks the `kind`
  brand). Never use a bare "Contract" for a specific kind.
- **Repo-wide `no-bare-cast` enforcement landed with R6.** Bare `as` casts are forbidden
  in production TS. Use `blindCast<T, "Reason">` / `castAs<T>` from `@makerkit/core/casts`,
  or rewrite to eliminate the cast (narrow with `in`/`typeof`, tighten a generic). The
  `biome-plugins/no-bare-cast.grit` plugin flags them at info level; the CI **cast ratchet**
  (`scripts/lint-casts.mjs`, `pnpm lint:casts`) fails any PR that increases the count.
  `as const` and test files are exempt. **This is a hard rule — do not add bare `as`.**

## Next work (confirm scope with the operator)

- **Primary — the `makerkit deploy` CLI** over a declarative `makerkit.config.ts`,
  replacing the interim per-example `alchemy.run.ts`. Brief:
  `.drive/projects/authoring-layer/makerkit-deploy-cli-brief.md`. This also folds
  `examples/storefront-auth/scripts/bundle-next.ts` into `@makerkit/nextjs`'s assembler.
- **R6 follow-ups (deferred):** in-memory/mock bindings, structural `satisfies`,
  gRPC/WebSocket kinds, PDL authoring surface, contract errors, distributed spec compare,
  hex boundary ports.
- **Smaller cleanups** are listed under "Deferred" in `plan.md` (deterministic
  Next-standalone artifact / idempotent redeploy; `@makerkit/node` rename; graph
  topological sort; config-key separator; the `port` param ↔ listen-port decoupling).

## How we work

- **Drive process.** For new work, invoke the `drive-process` skill; for design changes,
  `design-discussion` (updates `docs/design/` and adds an ADR under `90-decisions/`).
  Design docs are timeless — describe the decision, not the journey.
- **Subagents:** Sonnet-4.6-mid for implementers, Opus-4.8-mid for reviewers.
- **Prove it live.** The bar for a slice is a real deploy: `examples/storefront-auth`
  deploys to real Prisma Cloud and the storefront renders `auth.verify() -> { ok: true }`.
  CI's **E2E deploy** job does this; run `verify` / the deploy locally when you touch the
  runtime path. Don't call something done on a green typecheck alone.
- **Commits:** sign off **every** commit (repo DCO — `-s` plus the operator's human
  `Signed-off-by` trailer; see the git-as-bot setup in your global `CLAUDE.md` and
  `.cursor/rules/git-staging.mdc`). Stage explicitly (not `git add -A`). Single-quoted
  commit messages (`.claude/skills/multiline-commit-messages`).
- **Prose:** brief, plain English, no invented jargon. Minimize what the operator must read.

## Environment footguns (important)

- **Nested repos `ignite/`, `pdp-control-plane/`, `prisma-next/` are NOT part of MakerKit.**
  They're separate checkouts sitting in the tree. Never edit or commit them; never stage
  files under them.
- **Push agent branches only via the bot SSH remote** (`git@github-wmadden-electric:...`,
  the `bot` remote), never `origin`/HTTPS. `gh` acts as the `wmadden-electric` bot.
- **Never print `PRISMA_SERVICE_TOKEN` or any secret.** The E2E is a real-cloud deploy;
  creds live in the gitignored root `.env` (`PRISMA_SERVICE_TOKEN`, `PRISMA_WORKSPACE_ID`,
  `ALCHEMY_PASSWORD`).
- **The server runtime is Bun**, not Node.js — the auth entry binds with `Bun.serve`, uses
  `Bun.SQL`, and deploys with `bunx --bun alchemy deploy`. `@makerkit/node` is only a
  *build descriptor* (`kind: 'node'` = "plain server process", vs `nextjs`).
- **Bundling rule:** tsdown's `noExternal` must inline the app's own hex packages
  (`@storefront-auth/*`), not just `@makerkit/*`. A contract imported by package specifier
  and left external is an unresolved import in `main.mjs` that boot-crashes the artifact —
  Compute then serves "Service not found." (This regressed the R6 E2E; fixed in PR #13.)
- **Toolchain:** pnpm workspace + turbo. `pnpm typecheck`, `pnpm test`, `pnpm lint`,
  `pnpm lint:casts`, `pnpm build`. Workspace packages export raw `.ts`; Next transpiles them.
