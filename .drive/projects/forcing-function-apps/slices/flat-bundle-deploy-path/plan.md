# Dispatch plan: flat-bundle-deploy-path

Four dispatches, sandwich shape: substrate+node (D1) → nextjs (D2) →
packager (D3, independent) → consumer migration (D4). Sequential loop; D3 is
genuinely independent of D1/D2 (different package, no shared file) and could
run parallel, but the loop keeps it in sequence.

Contract source: [spec.md](spec.md). Do not re-derive the design; implement it.

---

## D1 — node adapter honors the flat-bundle contract (+ the assembly substrate)

**Outcome:** a node service — including the cron scheduler, whose build module
is `scheduler-service.mjs`, not `service.ts` — assembles its wrapper to
`main.mjs` inside a deploy-owned, address-keyed dir
(`<cwd>/.prisma-composer/artifacts/<address>/`), with the user's built entry
copied in beside it. Nothing is written into `node_modules` or the user's build
output.

**Includes the substrate** (delivered here because it has no observable value
without a consumer): `AssembleInput` gains `address: string` and a deploy-cwd
handle (`deploy.ts`); `assembleServices` threads the loop `id` as address and
`cwd` through `RunAssembler`/`buildControlAssemble` (`assemble-services.ts`);
the CLI passes its `cwd` (`main.ts:234`, cwd already at :192).

**Implementation notes (from grounding, not prescriptions):** replace
`entry: [serviceModule]` + the `readdirSync(...).find(/^service\.m?js$/)` +
rename with tsdown object entry `entry: { main: serviceModule }` → emits
`main.mjs` directly. Keep `config: false` and the reserved-`main` basename
error. Stage under cwd, not `dirname(entryPath)/bundle`.

**Builds on:** — (first).
**Hands to:** `AssembleInput` carries `address` + `cwd`; the node adapter reads
them; `main.mjs` staging is deploy-owned and address-keyed.

**Completed when:**
- `pnpm test:packages` covers a node assemble over a non-`service.ts` module
  (cron-scheduler shape) producing `main.mjs`; asserts staging is under
  `.prisma-composer/artifacts/<address>/`, not `node_modules`/user output.
- Existing node-adapter + assemble tests green with the new `AssembleInput`.

## D2 — nextjs adapter takes the standalone path; stops completing the tree

**Outcome:** `nextjs()` takes a **user-supplied standalone directory path**
(relative → `dirname(module)` per ADR-0004, absolute passthrough) instead of
`appDir`; `assemble()` validates that dir has the entry and adds the `main.mjs`
wrapper (address-keyed staging, as D1) — and does nothing else. No
`nextStandaloneDir` derivation, no static/`public/` copy.

**Implementation notes:** delete `nextStandaloneDir` + `standaloneEntryPath`'s
derivation; the standalone dir is now an input. Rename the `NextjsBuildAdapter`
field (`appDir` → e.g. `standalone`) and update `index.ts`'s doc + type. Drop
the fs copy of `.next/static` and `public/`. Add the reserved-`main` basename
assertion for parity with node.

**Builds on:** D1 — the `AssembleInput` shape (`address` + `cwd`) and the
`main.mjs`/address-staging convention.
**Hands to:** `nextjs()` on the standalone-path API; nextjs assemble validates
+ wraps only.

**Completed when:**
- `pnpm test:packages` covers a nextjs assemble where the standalone dir sits
  at a non-4-levels depth (the datahub `apps/web` shape) and resolves correctly
  from a user-supplied path; asserts no static/public copy occurs.
- A missing-entry standalone still errors with "run `next build`".

## D3 — packager rejects symlinks (flat-only)

**Outcome:** `packageComputeArtifact` fails fast on a bundle containing a
symlink, naming the path and the fix; the deterministic tar stays regular-files
only.

**Implementation notes:** in `walkFiles` (`compute/artifact.ts:49`), branch on
`entry.isSymbolicLink()` → throw
(`bundle contains a symlink at <rel>; deploy bundles must be flat — materialize
links in your build, e.g. cp -RL`). No deref, no symlink tar entries.

**Builds on:** — (independent of D1/D2; different package).
**Hands to:** the packager enforces flat.

**Completed when:**
- `pnpm test:packages` covers `walkFiles`/`packageComputeArtifact` over a
  fixture tree containing a relative dir-symlink → throws the actionable error.
- Existing artifact/packager tests green.

## D4 — storefront-auth (the one nextjs example) migrates to the contract

**Outcome:** storefront-auth's storefront module builds a **complete flat
standalone** (next build → copy `.next/static` + `public/` → no symlinks) and
its `nextjs()` call uses the standalone-path API, so its deploy path works with
the framework no longer completing the tree. `.prisma-composer/` is gitignored.

**Implementation notes:** update
`examples/storefront-auth/modules/storefront/src/service.ts`'s `nextjs({...})`
to the new field; add the flatten/copy step to that module's build script.
storefront-auth is pnpm+hoisted (no symlinks today) so D3's error stays dormant
for it — don't regress the `.npmrc` hoist shim.

**Builds on:** D2 (new nextjs API) + D3 (flat requirement).
**Hands to:** the CI "Deploy, verify, destroy" job (storefront-auth) exercises
the new contract end-to-end.

**Completed when:**
- Locally: storefront-auth's build produces a standalone with `static/` +
  `public/` present and zero symlinks; `assembleServices` + `packageComputeArtifact`
  over that tree succeed (binary, local — the live deploy is the PR's CI).
- `examples/storefront-auth/.gitignore` ignores `.prisma-composer/`.

---

## Completeness check

Final hand-offs cover the slice-DoD: cron-shaped assemble (D1) + symlink
hard-error (D3) are the two named done-conditions; nextjs contract (D2) and the
one consumer (D4) close the "honor the contract end-to-end" coherence claim.
Every framework change ships with the unit test the spec's coverage-gap section
demanded.
