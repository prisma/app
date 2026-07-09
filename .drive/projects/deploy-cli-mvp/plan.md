# Deploy CLI MVP — Plan

## Summary

Four slices deliver `makerkit deploy`/`destroy` per the settled design
(ADR-0003…0006, `docs/design/10-domains/deploy-cli.md`): node identity and
assembly extraction run in parallel, the CLI lands on top of both, and the
final slice migrates the flagship example and flips CI. Each slice is one PR;
the interim deploy path stays green until the last slice deletes it.

**Spec:** `.drive/projects/deploy-cli-mvp/spec.md` ·
**Design notes:** `.drive/projects/deploy-cli-mvp/design-notes.md`

**Tracker:** GitHub PRs (repo convention — no Linear here; slice → PR).

## Sequence

```
[S1 node identity] ─┐
                    ├─→ [S3 CLI + fromEnv, proven on hello] ─→ [S4 storefront-auth + CI flip]
[S2 assembly]      ─┘
```

## Legend

`[ ]` not started · `[~]` in progress · `[x]` done (proof met)

---

## Build slices

### [x] Slice S1 — node identity + Load error quality (core)

> **Done.** Commits `fd6a0d8`…`d1843b5` + review fix `8f8c93e`. Opus review:
> MERGE-READY; M1 (requirePack) applied. Deviations recorded: connectionEnd
> name optional defaulting to type (ADR-0006 amended — rpc(contract) has no
> name slot); configOf() walks root.inputs directly instead of Load() (required
> so hex-composed services still resolve config at runtime; reviewer confirmed
> behavior-preserving). Note: R6 rpc-contracts merged mid-flight; the project
> branch rebased onto it during this slice's integration.

**Outcome:** every node carries `name` (ADR-0006) and its pack's package name;
service nodes carry `url` (ADR-0004). Pack factories (`compute`, `postgres`,
`http`) and both examples thread the new fields; all remain plain frozen
serializable data, deploy-time-inert at runtime. `Load` on a root service with
an unwired connection input fails naming the input and pointing at the
composing hex (deploy-cli.md's error table, rows 1–2). Interim
`alchemy.run.ts` path untouched and green.
**Proof:** unit tests for the new fields + the LoadError message; invariant
guards still green (authoring entries lean, no new imports); e2e unchanged.
**Builds on:** main (R5).
**Hands to:** S3 — nodes self-describe location (`url`), pack, and name.

### [x] Slice S2 — assembly extraction (`/assemble` entries)

> **Done.** Commits `d7ee9b9`…`20a26ee` + review cleanups `dae8152`. Opus
> review: MERGE-READY; MEDIUM fixed (node assemble rejects an app entry named
> main.js/main.mjs — reserved for the wrapper). Integration ported de8ec01
> (post-fork bundle-next fix) as an `assemble` option: `wrapperNoExternal`
> (both kinds) — the wrapper build can't rely on the artifact's node_modules
> for the service module's own import-time deps; storefront passes
> `@storefront-auth/*` + `arktype`. **S3 input:** the CLI has no config file,
> so it can't take per-app regexes — it needs a general answer for wrapper
> inlining (likely: inline everything not shipped in the artifact).

**Outcome:** `@makerkit/node/assemble` and `@makerkit/nextjs/assemble` exist
per design-notes' contract (`{ serviceDir, serviceModule, build } →
{ dir, entry }`), absorbing `examples/makerkit-hello/tsdown.config.ts`'s
two-build shape and `examples/storefront-auth/scripts/bundle-next.ts`
wholesale (validation, standalone fixups, wrapper bundle, bunfig guard). The
examples' build scripts become thin callers passing explicit paths; the
descriptor root entries stay pure data (invariant-guarded: no `node:` /
`alchemy` / `bun` tokens in descriptor entries; `/assemble` is deploy-only).
**Proof:** both examples build through the package assemblers and the e2e
deploy path is green as-is; invariant guards extended to the new entries,
including the runtime-portability check over all `packages/` sources (no
`bun` imports / `bun:` schemes / `Bun.` globals anywhere; `node:` builtins
allowed only outside authoring entries).
**Builds on:** main (R5) — parallel with S1, no shared files.
**Hands to:** S3 — assembly callable by kind with explicit path inputs.

### [ ] Slice S3 — the CLI, proven live on hello

**Outcome:** `packages/makerkit-cli` (bin `makerkit`, runtime-agnostic — no
bun-only APIs; runs under node ≥ 22.18 and bun) with
`deploy <entry> [--name] [--stage]` and `destroy …`, implementing
deploy-cli.md's pipeline: import entry → Load → infer pack (exactly one) →
`fromEnv()` (new export on `@makerkit/prisma-cloud/target`, erroring with the
missing variable's name) → per-service anchor from `url` → assembly by kind →
generate a readable stack module at `.makerkit/alchemy.run.ts` (gitignored,
regenerated per run, path printed on error) that calls `lower()` with the
computed values → shell to `alchemy deploy`/`destroy` against it
(design-notes call 2). Errors per the deploy-cli.md table, each exercised by
a test; the CLI test suite runs under node, proving node compat.
`examples/makerkit-hello` migrated: its `alchemy.run.ts` and deploy scripts
deleted.
**Proof:** live — `makerkit deploy` stands up hello (`select 1` serves),
redeploy is `Plan: … to noop`, `makerkit destroy` is clean (404 after).
**Builds on:** S1 + S2.
**Hands to:** S4 — a working CLI and one migrated example as the pattern.

### [ ] Slice S4 — storefront-auth migration + CI flip

**Outcome:** `examples/storefront-auth` deploys via `makerkit deploy app.ts`
(hex root; per-service dirs from `url`); its `alchemy.run.ts`, bundle scripts,
and deploy package-scripts deleted. `.github/workflows/e2e-deploy.yml` runs
build → `makerkit deploy --name <ephemeral>` → verify round trip →
`makerkit destroy`. Docs synced: core-model.md extension point moved to done
for what shipped; deploy-cli.md checked against what shipped (its
implementation decisions were settled at planning).
**Proof:** CI e2e green on the PR and after merge to main; live round trip
renders `Auth /verify says: 200 {"ok":true}`; no `alchemy.run.ts` remains in
the repo.
**Builds on:** S3.
**Hands to:** project close-out.

---

## Close-out (required)

- [ ] Verify all Project-DoD items in `spec.md`.
- [ ] Migrate long-lived docs into `docs/` (doc-sync happens in S4; verify
      nothing else lives only in `.drive/projects/deploy-cli-mvp/`).
- [ ] Strip repo-wide references to `.drive/projects/deploy-cli-mvp/**`.
- [ ] Final retro; land lessons in durable memory surfaces.
- [ ] Delete `.drive/projects/deploy-cli-mvp/`.
