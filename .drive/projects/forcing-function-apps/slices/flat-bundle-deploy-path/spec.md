# Slice: Honor the flat-bundle contract in the deploy path

## At a glance

The first real out-of-repo deploy (datahub) hit three deploy-path bugs, all one
root cause: the framework guessing facts that belong to the user or to
configuration. This slice makes `assemble()` and `package()` honor
[ADR-0005](../../../../docs/design/90-decisions/ADR-0005-users-build-the-framework-assembles.md)
(amended): the user's build produces a finished flat bundle; the framework only
validates it and adds its boot wrapper. Evidence + per-bug detail:
[`../../bugs-deploy-assembly.md`](../../bugs-deploy-assembly.md).

## Amendment (2026-07-13, post-review) — one generic adapter, no Next special-casing

Will's PR review (CHANGES_REQUESTED) rejected the over-built assembly. Superseding
design, all on this PR:

- **One build adapter, no node/nextjs split.** Generalize `node()` to
  `{ module, entry, dir? }`: `dir` is the compiled-output root shipped under
  `bundle/`, defaulting to `dirname(entry)`. Every existing `node()` caller is
  unchanged (dir defaults); Next just passes an explicit `dir` (its standalone
  root). `BuildAdapter` gains an optional `dir`. **Delete the nextjs adapter.**
- **No adapter-side tree logic.** No static/public copy, no reserved-`main`
  check (user code lives under `bundle/`, our `main.mjs` at the root — they can't
  collide), no `bunfig`.
- **`bunfig.toml` moves to the Compute packager** as a default artifact file
  (disabling bun auto-install is universal for Compute, not a build concern).
- **Ship the Next flatten as a framework utility**, not a hand-maintained app
  script: `prisma-compose next-standalone` copies `.next/static` + `public/`
  into the standalone app dir (located by finding server.js). The storefront
  example calls it in one line (`next build && prisma-compose next-standalone`);
  delete `flatten-standalone.mjs`.
- **`import.meta.url` stays** — the wrapper *is* the service module bundled
  (core-model.md:106); removing it is a separate boot-protocol ADR.
- Rewrite the `deploy.ts` `address` doc comment in plain English.

The sections below are the pre-review design; where they conflict, this
amendment wins.

## Chosen design

**Artifact layout (both adapters).** Assembly builds a per-service working dir
`<cwd>/.prisma-compose/artifacts/<address>/` containing:
- `main.mjs` — our wrapper, at the working-dir root.
- `bundle/` — the user's built output, copied in wholesale (already flat per
  the contract; a plain recursive copy).
The returned `Bundle.entry` is `bundle/<user's nominated entry relpath>`; the
wrapper loads `./bundle/<entry>`. Our files sit at the root, the user's tree
under `bundle/`, so nothing collides and we never write into their output. The
packager is unchanged — it already finds `main.mjs` at the root and injects
`bootstrap.js` + the manifest, and `bootstrap.js`'s `import("./<appEntry>")`
resolves because `appEntry` is now the `bundle/…`-prefixed path.

**1. Thread the graph address into assembly.** `AssembleInput` gains
`address: string` (deploy.ts). `assembleServices` already has it as the loop
`id` (assemble-services.ts:64) — pass it through `RunAssembler`/
`buildControlAssemble`. This keys the working dir per service.

**2. node adapter — dictate the wrapper name; use the `bundle/` layout.**
(`node/src/control.ts`.) Replace `entry: [serviceModule]` + the
readdir/regex/rename with a tsdown **object entry** `entry: { main: serviceModule }`,
so tsdown emits `main.mjs` directly — no discovery. Emit `main.mjs` to the
working-dir root; copy the user's already-built entry to `bundle/<basename>`;
return `entry: "bundle/<basename>"`. Keep the "no built entry — run your build"
and the reserved-`main` basename errors. (D1 landed an earlier flat variant with
the entry at the working-dir root — revise to the `bundle/` layout for parity.)

**3. nextjs adapter — take the standalone path; stop completing the tree.**
(`nextjs/src/control.ts`, `nextjs/src/index.ts`.) Change the authoring API:
`appDir` (from which the framework *derives* the standalone location via the
`../../../..` math) → a user-supplied **standalone root dir path** (`standalone`;
relative resolves against `dirname(module)` per ADR-0004, absolute passes
through), plus `entry` = the server path relative to that root (e.g.
`apps/web/server.js`). Delete `nextStandaloneDir` and its arithmetic. Delete the
static/`public/` copy step — the user's build produces the complete flat tree.
Copy the standalone root → `bundle/`, emit `main.mjs` at the working-dir root,
return `entry: "bundle/<user entry>"`. Keep the "no standalone entry — run
`next build`" error.

**4. packager — flat only; symlink is a hard error.**
(`compute/artifact.ts`.) In `walkFiles`, a symlink (`entry.isSymbolicLink()`)
throws, naming the path and the fix ("bundle contains a symlink at `<rel>`;
deploy bundles must be flat — materialize links in your build, e.g. `cp -RL`").
No dereferencing, no symlink tar entries. Regular files only.

**5. storefront-auth — the one nextjs example — moves tree-completion into its
build.** Update its `nextjs()` call to the standalone-path API, and its
storefront module build to produce a complete flat standalone (`next build` →
copy static + `public/` → ensure no symlinks). Required in this PR: without it
the framework's dropped copy step breaks storefront-auth's CI deploy.

## Coherence rationale

One principle applied end-to-end across the two deploy stages that consume a
built tree (assemble, package). The pieces are forced together: the framework
change and the storefront-auth build change must land in one PR or CI's
"Deploy, verify, destroy" goes red between them. A reviewer holds "does the
deploy path now touch only what the user handed it, plus the wrapper?" in one
sitting; it rolls back as one unit. Larger-but-cohesive, not splittable without
a red intermediate state.

## Scope

**In:** `AssembleInput.address` + threading; node adapter object-entry +
address-keyed staging; nextjs adapter API change + drop derivation + drop
static/public copy; packager symlink hard-error; storefront-auth `nextjs()` call
+ build flatten step; unit tests for all four framework changes.

**Deliberately out:**
- datahub's own flatten step + re-deploy — datahub PR, not this one.
- The `0.1.1` release that ships these fixes — a close-out step after merge.
- `prismaTsDownConfig()` build-config helper family — deferred, separate session.
- Any freshness/staleness checking of built output — ADR-0005 leaves it out.

## Pre-investigated edge cases

| Case | Handling |
| --- | --- |
| Wrapper build's tsdown still auto-loads a stray `tsdown.config.ts` | Keep `config: false` (node adapter comment explains why — it would rewrite the package's own `exports`). |
| App entry named `main.js`/`main.mjs` collides with the wrapper | Keep the existing reserved-basename error in the node adapter; add the equivalent to nextjs (its entry is `server.js`, so latent, but assert). |
| storefront-auth standalone has no symlinks today (pnpm + hoisted `.npmrc`) so bug 3 doesn't trip it | The symlink error stays dormant for it; datahub (bun) is what the error is for. Don't regress the hoist shim. |
| `.prisma-compose/artifacts/` under deploy cwd needs gitignoring in examples | storefront-auth already needs `.prisma-compose/` ignored (datahub added the same). Verify/add. |

## Done conditions (slice-specific)

- `examples/cron` assembles (the cron scheduler's non-`service.ts` module no
  longer breaks) and a bun-shaped standalone with symlinks fails the packager
  with the actionable error — both covered by new unit tests.

## Open questions

- Root for `.prisma-compose/artifacts/`: deploy `cwd` (where the CLI already
  writes `.prisma-compose/alchemy.run.ts` and state — main.ts:255) is the
  consistent choice. Confirm the assembler receives cwd or resolves it the same
  way the CLI does; if assembly has no cwd handle, thread it alongside `address`.

## References

- Contract: [ADR-0005](../../../../docs/design/90-decisions/ADR-0005-users-build-the-framework-assembles.md),
  [ADR-0004](../../../../docs/design/90-decisions/ADR-0004-paths-resolve-relative-to-the-authoring-file.md).
- Evidence: [`../../bugs-deploy-assembly.md`](../../bugs-deploy-assembly.md).
- Surfaces: `deploy.ts:108` (AssembleInput), `assemble-services.ts:44,64`,
  `node/src/control.ts:71-99`, `nextjs/src/control.ts:70-80`,
  `compute/artifact.ts` (walkFiles).
