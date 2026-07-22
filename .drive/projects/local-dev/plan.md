# Project plan: local dev (`prisma-composer dev`)

**Spec:** `.drive/projects/local-dev/spec.md` (exhaustive — the contract).
Design: ADR-0041 + `docs/design/10-domains/local-dev.md` (committed).

Five slices, one PR each. S1 and S2 are independent and can run in parallel;
S3 needs S1; S4 needs S3; S5 needs S2 + S4.

## Validation gates

Per slice unless stated: `pnpm typecheck`, `pnpm test`, `pnpm lint`,
`pnpm lint:deps` at the workspace root, plus the touched packages' own
scripts. Implementer dispatches use Sonnet-4.6-mid, reviewers Opus-4.8-mid
(operator's standing rule). No PR opens with a failing or skipped check.

## Slices

### S1 — `@internal/s3-protocol` extraction + disk store + server

- **Outcome:** new lowering-layer package holding `store.ts`, `sigv4.ts`
  (incl. `mintKeyPair`), `handler.ts`, `memory-store.ts` (moved), plus new
  `fs-store.ts` and `serve.ts` (node:http, SigV4 multi-credential, 501
  multipart). Storage module consumes it; public surface byte-compatible;
  its tests pass unmodified. `architecture.config.json` declares the package
  (spec § 1 — including the plane check that both import directions pass
  `lint:deps` **first**; a rejection is a stop condition).
- **Proves:** fs-store contract tests (sidecar lazily written for dropped
  files, path-escape rejection, list pagination, temp-then-rename), serve
  round-trip via a real S3 client (`@aws-sdk/client-s3` devDependency in
  tests only) incl. presigned GET/PUT.
- **Spec sections:** § 1, behavior contracts.

### S2 — `dir()` build adapter

- **Outcome:** `@prisma/composer/dir` authoring + assemble per spec § 6:
  verbatim tree copy, named entry, symlink hard error, wrapper bundling
  identical to `node()`'s. Guide/docs entry.
- **Proves:** assemble tests (missing dir/entry errors verbatim, symlink
  error, tree fidelity); a fixture app with a multi-file runnable deploys
  through the full assemble path (no cloud needed — assemble-level test).
- **Spec sections:** § 6.

### S3 — the dev target: core seam + local providers + dev lowering path

- **Outcome:** `DevDescriptor`/`DevStandInsInput`/`DevStandIns` +
  `dev-process.ts` in core; `LowerOptions.dev` + `mergedDevProviders`;
  `serviceAddress` threading (`ComputeSerialized.address` →
  `DeploymentProps.serviceAddress`); `@internal/lowering/dev` (dev-store,
  compute/postgres/bucket local providers, `devProviders()`,
  `artifact-extract.ts`, `resolve-bin.ts`); target extension `src/dev/*`
  (container, preflight + shared `preflight-names.ts`, stand-ins, teardown)
  and `prismaCloud()`'s `dev` field; the lazy `resolveOptions` restructure
  (factory constructs with no env).
- **Proves:** integration test (no CLI): a fixture topology (compute +
  postgres + bucket) lowered with `dev: true` and driven through
  `alchemy deploy --stage dev` programmatically produces a correct process
  table, env store (incl. port override + poison rows + secret pointers),
  running `prisma dev` instance, and unpacked artifacts; the scrubbed-env
  test (`prismaCloud()` with no `PRISMA_*`); ustar extract round-trips
  `packageComputeArtifact`'s output; placeholder minting stable across two
  preflight runs; env-param missing → listing error.
- **Depends on:** S1 (bucket providers + mintKeyPair home).
- **Spec sections:** § 2, § 3, § 4, value-sourcing + determinism contracts.

### S4 — the `dev` command: pipeline, supervisor, watch, error surface

- **Outcome:** `DevCommand` + `run-dev.ts` + shared `pipeline.ts` refactor of
  `run()`; `generate-dev-stack.ts`; `supervisor.ts` (spawn-under-bun, pid
  recovery, crash backoff + standing error block, log prefixing, shutdown
  order); `watch.ts` (debounced rebuild → re-assemble → re-converge →
  reconcile; converge failure keeps old processes); `--fresh`; front-door
  printing; every error string from the spec's tables verbatim.
- **Proves:** the spec's acceptance criteria 1–5 on `examples/store`,
  scripted as an integration test where feasible (bring-up, single-service
  restart on rebuild, data persistence across restarts, `--fresh` wipe,
  placeholder warning) plus manual verification of log/TTY output; unit
  tests for backoff, pid-recovery matching rule, table reconcile diffing,
  watch debounce.
- **Depends on:** S3.
- **Spec sections:** § 5, § 7 (gitignore check), error surface.

### S5 — proof on the open-chat port + measurement + close-out docs

- **Outcome:** the open-chat port (separate repo) switched to `dir()` +
  `prisma-composer dev`, replacing `scripts/dev.ts`; sign-in/history/
  live-tail verified; friction found lands here as fixes (re-triaged if
  large); restart latency for `examples/store` measured and recorded;
  `deploy-cli.md` scope updated; `local-dev.md` + ADR-0041 reconciled with
  what shipped; port-repo changes committed there.
- **Depends on:** S2 + S4.
- **Spec sections:** acceptance criteria 6–9.

## Close-out (required)

- [ ] Verify all acceptance criteria in `.drive/projects/local-dev/spec.md`
- [ ] Final retro
- [ ] Migrate long-lived docs into `docs/` (local-dev.md/deploy-cli.md/ADR
      already live there — reconcile, don't duplicate)
- [ ] Strip repo-wide references to `.drive/projects/local-dev/**`
- [ ] Delete `.drive/projects/local-dev/`
