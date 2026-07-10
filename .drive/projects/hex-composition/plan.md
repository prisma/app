# System Composition — Plan

## Summary

Three slices: the core boundary/forwarding/nesting reshape, the deploy-pipeline
follow-through (hierarchical bundle keys + adapter resolution anchor), and the
reusable Auth system proven live with its fake. Design contract: ADR-0016 +
`docs/design/10-domains/system-composition.md`.

**Spec:** `.drive/projects/system-composition/spec.md` ·
**Design notes:** `.drive/projects/system-composition/design-notes.md`
**Tracker:** GitHub PRs (repo convention).

**Rebase baseline (H1 integrated pre-baseline; H2 dispatches post-rebase):**
this branch rebases onto PR #21 (resource decoupling) then PR #22 (always-system
root) once both land. Assume always-system root and bundles-keyed-by-address as
given; `prisma-app-hello` and the e2e hello/redeploy-noop job are gone (repoint
fixtures at `examples/storefront-auth`). Full facts in design-notes.md §
Coordination facts.

## Sequence

```
[H1 core boundary/forwarding/nesting] → [H2 pipeline follow-through] → [H3 auth system + fake, live]
```

(H2's adapter-anchor commit is independent of H1 and may be cherry-picked
early if useful; the hierarchical-keys commit depends on H1's addresses.)

## Legend

`[ ]` not started · `[~]` in progress · `[x]` done (proof met)

---

## Build slices

### [ ] Slice H1 — core: boundary, forwarding, nesting

**Outcome:** `system(name, { deps?, expose? }, body)` with `SystemContext`
(`inputs` + `provision`) and outputs-as-return, per system-composition.md § The
authoring surface. `provision()` gains the system overload returning
`ProvisionedRef<E>`. Load flattens recursively with dot-joined hierarchical
addresses and enforces the four boundary-validation rules (dangling input,
missing/unsatisfied expose, root-with-deps, forwarding cycles), each with a
fix-naming error and a test. Existing system call sites (storefront-auth's
`system.ts`, core/cli/integration tests and fixtures) migrate to the new shape.
Compile-time expose/wiring checks proven with type-level tests (the R6
`test-d` pattern).
**Proof:** unit + type-level tests for every rule; all gates green; the
existing e2e path still deploys (flat systems are the empty-boundary case).
**Builds on:** main (post-CLI). Coordinates with the resource-decoupling
session (shared files — whoever lands second rebases).
**Hands to:** H2 — hierarchical addresses exist; H3 — the authoring surface.

### [ ] Slice H2 — pipeline follow-through

**Outcome:** assembled-bundle correlation keys follow full hierarchical
addresses through `@prisma/app-assemble`, the generated stack file, and
`lower()`'s bundle lookup. Adapter resolution moves to the service's
`build.module` anchor (`${build.pack}/assemble` seeded at the authoring file,
per amended ADR-0004) — an installed system's adapter choice stays internal.
**Proof:** integration test: a fixture package whose service uses an adapter
the consuming app doesn't declare resolves and assembles; a nested-system
fixture deploys through the generated stack file (fake alchemy seam) with
correctly keyed bundles.
**Builds on:** H1 (addresses); the anchor change itself has no H1 dependency.
**Hands to:** H3 — installed systems assemble.

### [ ] Slice H3 — the reusable Auth system, live, with its fake

**Outcome:** a workspace package (e.g. `examples/auth-system`) exporting an Auth
system per ADR-0016's grounding example — built runnables shipped in-package,
`@prisma/app*` as peer dependencies, expose = the auth contract; `db` as a
boundary input if resource slots have landed, internally owned otherwise.
`examples/storefront-auth` provisions it (nested system, forwarding both ways)
and the storefront consumes only the contract port. A fake same-contract
service proves substitution in an alternate topology without touching the
storefront. CI e2e flips to the composed topology. Docs synced to what
shipped; project close-out.
**Proof:** CI e2e green — live deploy of the nested topology, round trip
renders, destroy clean; the fake proven by typecheck + an integration test
through the real CLI's Load path.
**Builds on:** H1 + H2.
**Hands to:** project close-out; the shared-resource/data-contract project
inherits a composition-ready model.

---

## Close-out (required)

- [ ] Verify all Project-DoD items in `spec.md`.
- [ ] Migrate long-lived docs into `docs/` (design docs already live there;
      verify nothing lives only in this workspace).
- [ ] Strip repo references to `.drive/projects/system-composition/**`.
- [ ] Final retro; delete `.drive/projects/system-composition/`.
