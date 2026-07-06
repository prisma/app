# Slice R2 — storefront-auth partial migration (mixed topology)

## At a glance

Both storefront-auth services become pack-authored nodes; the hand-written stack
shrinks to the wiring the primitives can't express yet:

```ts
// examples/storefront-auth/alchemy.run.ts — hand-written stack, MakerKit nodes inside
export default Alchemy.Stack("StorefrontAuth", { providers, state },
  Effect.gen(function* () {
    const auth = yield* lowering(authService, target, { name: "makerkit-auth", artifact: authArtifact })
    const url  = auth.outputs.url                     // explicit fail if absent — no cast
    yield* Prisma.EnvironmentVariable("storefront-auth-url", { key: "AUTH_URL", value: url, ... })
    const store = yield* lowering(storefrontService, target, { name: "makerkit-storefront", artifact: storeArtifact })
    return { authUrl: url, storefrontUrl: store.outputs.url }
  }))
```

## Chosen design

Per the project spec and `core-model.md` § the composable `lowering()` form:

- **auth** (`hexes/auth`): `compute({ db: postgres<SQL>() }, ({ db }, { port }) =>
  Bun.serve(...))` — the Hono app takes the injected client; `main.ts` owns the
  driver import and `runtime({ clients })`; app-owned tsdown build (mirroring
  makerkit-hello). Its hand-rolled `process.env` reads disappear.
- **storefront** (`hexes/storefront`): `compute({}, framework-boot handler)` — the
  handler boots the Next standalone `server.js` (the framework-as-Output-adapter
  shape). No `db` input: nothing consumes it today (unattended decision D3). The
  artifact stays the existing `bundle-next.ts` product, with the entry now the
  MakerKit `main.ts` that `runHost`s the service; Next-internal env reads
  (`AUTH_URL`, `PORT`) stay — the documented `use()` gap.
- **stack**: hand-written, yields `lowering()` per service, hand-wires only the
  `AUTH_URL` EnvironmentVariable + ordering (the documented Connection gap). The
  deployed-URL-into-`Input<string>` landmine resolves example-side with an explicit
  failure, not a cast (unattended decision D2).

## Coherence rationale

One PR: two service modules rewritten to the pack vocabulary, one stack rewritten to
the mixed form, build scripts adjusted — reviewable in one sitting against "does the
mixed topology match the design and does the live round trip still work."

## Scope

**In:** the two service modules + main entries; both build paths; the mixed
`alchemy.run.ts`; **destroy the old hand-wired deployment first** (its local Alchemy
state; the migrated stack has different resource identities — deploying over it
would orphan the live resources, unattended decision D4); deploy the migrated stack
fresh → live storefront→auth round trip → redeploy idempotence check; PR open.
**Out:** the Connection primitive (AUTH_URL stays hand-wired); `use()` DI;
prisma-alchemy changes (typing landmine resolved example-side); makerkit-hello
(done in R1); destroying the *end* state (the migrated system stays live as the
standing demo).

## Pre-investigated edge cases

- The `EnvironmentVariable` `Input<string>` landmine (D2) — explicit fail, no cast.
- Next standalone must be `force-dynamic` for runtime `AUTH_URL` (already in place —
  don't regress it).
- Bun.SQL idle-connection guards in auth (`max: 1`, `idleTimeout`, error → 503) must
  survive the rewrite — they move into the app's client factory / handler, not core.
- Deploy ordering: `AUTH_URL` EnvironmentVariable must be created before the
  storefront's version starts (the prior stack's ordering — keep it).
- Compute scale-to-zero: round-trip verification tolerates ~15s of 502 first.

## Slice-DoD

Plan.md R2 **Outcome** met: both services pack-authored, only `AUTH_URL` hand-wired,
deployed storefront→auth round trip verified live (storefront page renders auth's
answer), zero `process.env` in both services' src (deploy script + Next-internal
reads exempt as documented). Gates: workspace typecheck + tests green; both artifacts
build. CI-green + reviewer-accept + project-DoD floor inherited.

## Open questions

None — D2/D3 decided and logged in `wip/unattended-decisions.md` (unattended mode).

## References

- Project spec §§ real-example requirement + mixed topology; `core-model.md`
  § Lowering (composable form); `examples/storefront-auth` (current hand-wired
  stack + bundle scripts); plan.md § R2 (landmine note).
