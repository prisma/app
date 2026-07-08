# Task brief — the `makerkit deploy` CLI

A brief for the agent taking the CLI track. Runs **in parallel** with the typed-HTTP-connection track (a strict file boundary keeps them from colliding — see § Boundary). Forks off the R5 tip once R5 lands.

## 1. What we want (the outcome)

The standard deploy path where **the app author writes no stack file**. Today the example ships a hand-written `alchemy.run.ts` that calls `lower()` with a per-service `bundles` map. We want to replace that with:

```ts
// makerkit.config.ts — the whole deploy declaration
import app from "./src/service"                 // a ServiceNode or a HexNode
import { prismaCloud } from "@makerkit/prisma-cloud/target"
export default {
  app,
  target: prismaCloud({ workspaceId: requiredEnv("PRISMA_WORKSPACE_ID") }),
  name: "storefront-auth",
}
```

and a CLI:

```
makerkit deploy     # assemble every service, lower(), run the Alchemy stack
makerkit destroy    # tear the stack down
```

`makerkit deploy` reads `makerkit.config.ts`, runs **each service's build-adapter assembler** to produce its artifact input, then calls `lower(app, target, { name, … })` internally and runs the resulting Alchemy stack. It owns the build→deploy pipeline in **one pass**, which is what lets the per-service bundle map disappear from user-facing config.

This realizes two things R5 deliberately deferred:
1. the build-adapter **assembler** side — `@makerkit/node/assemble`, `@makerkit/nextjs/assemble` (R5 shipped only the lean descriptors);
2. the removal of the interim `alchemy.run.ts` + `LowerOptions.bundle(s)` as user-facing surface.

## 2. What we know (the settled contract)

The contract is **`docs/design/10-domains/core-model.md`** — read § Lowering, § "The build adapter — worked instances", and § Extension points ("MakerKit-owned deploy entrypoint"). In brief:

- **`makerkit.config.ts`** = `{ app: ServiceNode | HexNode, target: Target, name: string }`. `lower()`/`lowering()` stay as the mechanism and the mixed-stack escape hatch — the CLI **wraps** them, never replaces them.
- **Build adapter = two pieces.** The **descriptor** (`{ kind, entry }`) already rides on the service node (`node.build`, shipped in R5; `@makerkit/node` / `@makerkit/nextjs` export the descriptor factories). The **assembler** is the deploy-side half this task builds:
  ```ts
  // @makerkit/<adapter>/assemble
  interface Assembler {
    assemble(input: { serviceDir: string; build: BuildAdapter }): Promise<AssembledBundle> // { dir, entry }
  }
  ```
  It normalizes the app's built output into a bundle dir containing the **MakerKit wrapper** (`service.ts` bundled → `main.mjs`, core inlined once, the app entry left to a runtime dynamic import) plus framework fixups, and reports the runtime `entry` (the app's runnable, relative to `dir`).
- **`package()` (pack, already done in R5)** consumes `{ assembled: { dir, entry }, address }` and prints the bootstrap `import main from "./main.js"; await main.run("<address>", () => import("./<entry>"))`, then deterministically tars. The CLI feeds `package()` via `lower()` — it does not print bootstraps itself.
- **The assembler bodies already exist as interim code** in the R5 example build scripts and must be absorbed:
  - `examples/storefront-auth/hexes/auth/scripts/build.ts` — the `node` case: bundle `service.ts` → `main.mjs` (wrapper, `bun` external) and place the app's built `server.js`; report `entry: "server.js"`.
  - `examples/storefront-auth/hexes/storefront/scripts/bundle-next.ts` — the `nextjs` case: the standalone fixups (copy hoisted `node_modules`, `.next/static`, `public`; write `bunfig.toml` with `[install] auto = "disable"` — PRO-213), bundle `service.ts` → `main.mjs`, report the standalone `server.js` path.
- **Determinism:** the `node`/tsdown wrapper is byte-deterministic; the Next standalone embeds a per-build `BUILD_ID`, so a Next redeploy may re-version even when unchanged. This is a **known, separate follow-up** — do not try to solve it; keep any idempotence assertion off the Next path.
- **How deploy runs today** (to preserve): `lower()` returns an Alchemy stack (the default export the `alchemy` CLI consumes). The interim flow is `bunx --bun alchemy deploy`. Env in play: `PRISMA_SERVICE_TOKEN`, `PRISMA_WORKSPACE_ID`, `ALCHEMY_PASSWORD`. The e2e workflow (`.github/workflows/e2e-deploy.yml`) drives the current path and will need updating to `makerkit deploy`.

## 3. The open design question — you must resolve it (and flag your call)

An imported service **value carries no filesystem path**. The CLI must correlate each provisioned service (by its id/address in the hex) to its **source dir**, to anchor the descriptor's relative `entry` and run its assembler. Candidate mechanisms:

- **Convention** — `hexes/<id>/` (the example already uses exactly this layout; the hex provision id maps to the dir).
- **Source-scan** — walk the project, find service modules, read each one's `build` descriptor + record its path (infer-from-source, the project's guiding principle).
- **Explicit map in `makerkit.config.ts`** — rejected; that is the bundle map we are removing.

Do a **short design pass** on this specifically, recommend a direction (convention is the low-risk default given the current layout), and get it reviewed before implementing the rest. This is the one genuine design call in the task; the rest is building to the settled contract.

## 4. Sub-decisions to make (smaller, call them in the design pass)

- **Does `makerkit deploy` run the framework build** (`next build`, the app's bundler) or assume it's pre-built? The "one pass" value argues for the CLI orchestrating it — but then it needs each app's build command. Where is that declared: a convention (`package.json`'s `build` script per hex), or a field on the descriptor? Recommend and justify.
- **How the CLI runs the Alchemy stack** — shell out to `alchemy deploy` on a generated stack module, or run the Alchemy engine programmatically from `lower()`'s return. Prefer whichever avoids a generated temp file if clean.
- **Command surface** — at minimum `deploy` + `destroy` (the e2e needs destroy). `logs` is out of scope.
- **`LowerOptions.bundle(s)`** — the CLI populates it internally (after assembling) when calling `lower()`, so it stays as the internal carrier but leaves user config. Keep the type; just stop asking the user to write it.

## 5. Scope

**In:**
- New CLI package (`@makerkit/cli` or similar) exposing `deploy` + `destroy`, reading `makerkit.config.ts`.
- The two assembler entries: `@makerkit/node/assemble`, `@makerkit/nextjs/assemble` (absorb the R5 example build-script logic).
- The value→location mechanism (§3) + the framework-build orchestration (§4).
- Migrate `examples/storefront-auth` to `makerkit.config.ts`; delete `alchemy.run.ts` and the hand-written build scripts once their logic lives in the assemblers.
- Update `.github/workflows/e2e-deploy.yml` to `makerkit deploy` / `makerkit destroy`.
- Prove live: `makerkit deploy` stands up storefront-auth on real Prisma Cloud (round trip renders `Auth /verify says: 200 {"ok":true}`), `makerkit destroy` tears it down.

**Out (do not touch):**
- The typed-interface work (the parallel track). Do **not** edit `service.ts`, `server.ts`, `page.tsx`, core `config.ts`/`node.ts`/`graph.ts`/`hydrate.ts`, or the pack's `http.ts` — those belong to the interface track.
- The hosted Alchemy state store (separate operational track).
- The deterministic Next artifact (known follow-up).
- `lower()`/`lowering()` themselves — wrap, don't rewrite.

## 6. File-ownership boundary (parallel-track safety)

Runs in an **isolated worktree** off the R5 tip. Owns and edits only:
- `examples/storefront-auth/alchemy.run.ts` → `makerkit.config.ts`; the example build scripts; the two adapter `/assemble` entries; the new CLI package; `deploy.ts`'s bundle handling; the e2e workflow.
Must **not** edit: `service.ts`, `server.ts`, `page.tsx`, core authoring/Load/runtime files, pack `http.ts` (interface track). These are disjoint from the interface track's files, so the eventual merge is trivial; whichever lands second rebases onto the first.

## 7. Constraints

- **Doc-first covenant:** a forced deviation from `core-model.md` is flagged and the doc amended with the operator first — never a silent divergence.
- **Invariants:** the `/assemble` entries are deploy-only (may use `node:fs`, tar, framework tooling); the descriptor `.` entries stay lean (no `node:`/`alchemy`/`bun` tokens). The runtime bundle never gains the CLI or an assembler.
- **Security:** never print `PRISMA_SERVICE_TOKEN` or any secret; deploy under the bot credential flow; the isolated worktree is yours.
- Respect the strict tsconfig (bracket index access, null-guards, `exactOptionalPropertyTypes`) and Biome.

## 8. DoD

- `makerkit deploy` deploys `examples/storefront-auth` to real Prisma Cloud with **no** `alchemy.run.ts` and **no** user-written bundle map; the assemblers produce the artifacts; the round trip is live; `makerkit destroy` is clean.
- The value→location design pass is reviewed and settled.
- Idempotent redeploy is a no-op where deterministic (`node`); the Next path's known non-determinism is documented, not asserted.
- typecheck / test / Biome green; `core-model.md`'s "MakerKit-owned deploy entrypoint" extension point moved from "designed" to "done" for what shipped.

## 9. References

- `docs/design/10-domains/core-model.md` — §§ Lowering, build adapter, Extension points (the contract).
- `.drive/projects/authoring-layer/slices/r5-authoring-surface/design-note.md` — the build-adapter split + the interim this finishes.
- `.drive/projects/authoring-layer/plan.md` — "MakerKit-owned deploy entrypoint" (decision 9).
- The R5 example build scripts (`scripts/build.ts`, `scripts/bundle-next.ts`) — the assembly logic to absorb (final form lands with R5).
