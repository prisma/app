# Slice R4 — the Connection primitive (+ minimal hex, application placement)

## At a glance

```ts
// storefront service — declares the dependency; never learns how the address arrives
const auth = http()
export default compute({ auth }, async ({ auth }, { port }) => { /* auth.fetch("/verify") */ })

// the app's hex — transparent wiring, runs at Load
export default hex("storefront-auth", (h) => {
  const authRef = h.provision("auth", authService)
  h.provision("storefront", storefrontService, { auth: authRef })
})

// alchemy.run.ts — the whole deploy script
export default lower(appHex, prismaCloud({ workspaceId }), {
  name: "StorefrontAuth",
  bundles: {
    auth: { dir: "hexes/auth/dist/bundle" },
    storefront: { dir: "hexes/storefront/dist/bundle" },
  },
})
```

The ten hand-written plumbing lines, the `requireStringOutput` guard, and the
hand-named `EnvironmentVariable` die. The fresh-deploy config race becomes
structurally impossible (the `environment` edge). One Project per application;
`DATABASE_URL` poisoned.

## Chosen design

**The contract is `core-model.md` at `19fb9ef`** (three execution paths; phased
service SPI + `application.provision`; ConnectionEnd/hex/HexBuilder; DAG check;
sequencing as dependency edges) **plus `docs/design/05-prisma-cloud/*`**
(placement rule, poison policy, lowering graphs, PDP timing model). Deviations
amend the docs with the operator first — unchanged covenant.

## Coherence rationale

One PR, reviewable as "does the built system match the recorded design": core
graph/SPI work, the pack reshape, one `prisma-alchemy` prop, and the two examples
migrated to the new placement. Large but a single coherent story; the review
loop's per-dispatch structure keeps each sitting bounded.

## Scope

**In:**
- **core `.`**: `ConnectionEnd` + `connectionEnd()`, `hex()`/`HexBuilder`
  (`provision(id, service, wiring?)`), `Deps` widened, `Hydrated` covering
  connection ends, Load executing hex bodies (edge kinds `input`/`connection`,
  dangling-connection error, DAG check naming the cycle), `configOf` over
  connection inputs (`owner: { input }`).
- **core `/runtime`**: connection ends hydrate through the existing pipeline
  (no new mechanism — prove by test).
- **core `/deploy`**: `Target.application` + `ApplicationLowering`;
  `LowerContext.application`; new sequencing (application once → per service:
  resources → provision → resolve params from resource outputs + producer
  deploy outputs → writeConfig → package → deploy); `LowerOptions.bundle(s)`
  (app-built bundle dirs — tars/hashes die from the options); hex roots in
  `lowering()`/`lower()`; **bootstrap generation** (zero-dep source: core's
  prebuilt single-file `/runtime` inlined + `import service from "./main.js"` +
  `runHost(service, { id: address })`). Identity = the node's address from
  graph position (decision 8). `ConfigRequest.service` + `runHost({ id })`.
- **core `/runtime`**: additionally built as a self-contained single file
  (it imports nothing by invariant) for bootstrap inlining.
- **pack**: `http()` + default fetch client (app-factory override);
  `prismaCloud()` reshaped per the worked instance — `application.provision`
  (Project + **poison `DATABASE_URL`/`DATABASE_URL_POOLED`**, empty-string value
  with `"-"` fallback), `resources.postgres` → real `Database` + `Connection`,
  `services.compute` → provision (App) / writeConfig (per-service keys from the
  address via the one shared mapping module) / **package** (bundle + bootstrap +
  `compute.manifest.json` → deterministic tar; the envelope leaves app code) /
  deploy (Deployment with `environment` prop, consuming package's artifact).
- **prisma-alchemy**: `Deployment` gains the `environment` prop (env-var record
  refs — the ordering/propagation edge). In scope by design decision.
- **examples**: both migrate to single-Project placement. storefront-auth gains
  the app hex; `alchemy.run.ts` shrinks to the three-liner; storefront declares
  `auth: http()`. makerkit-hello: same placement, explicit db variable. Both:
  `main.ts` becomes a pure re-export of the Service; build scripts stop writing
  `compute.manifest.json`/tar (the pack packages) — the build is bundling only.
- **Deploy proof**: destroy the old two-project live demo first (identities all
  change — D4 precedent); deploy the single-project layout; **assert the race
  does not occur on the fresh deploy** (round trip green on the first version —
  this is the slice's headline proof); idempotence; leave live. Hello ephemeral
  cycle stays green.

**Out:** typed connection interfaces / generated clients; hex boundary
ports/nesting/forwarding; runtime name lookup; preview class / branch overrides;
`use()` DI (the Next page reads the connection's *physical* key directly — an
accepted wart of the documented framework-DI gap; the pack's key naming is
deterministic and documented for exactly this interim).

## Pre-investigated edge cases

- Ordering is **edges, not statement order**: the `environment` prop is the only
  thing standing between us and the PRO-211 race — verify the edge exists in the
  plan (dry-run inspection) before trusting the deploy.
- Producer URL trustworthy only post-deploy (PRO-200): consumer param resolution
  must consume the producer's *deploy-phase* outputs.
- Poison value: try `""`; if the API rejects empty values, `"-"` (verify at the
  deploy dispatch, record which).
- Boot-side key reconstruction: identity CANNOT travel through the environment
  (every App in a Project boots a byte-identical env — proven from PDP source;
  a reserved identity variable is one shared key, last write wins). It rides
  the artifact: the deploy-generated bootstrap passes the address to
  `runHost({ id })` (decision 8). `package` must be byte-deterministic (fixed
  tar mtimes/ordering) or every redeploy churns a new version.
- The migration destroy must use the *existing* code + local state before the
  rework lands in the deploy script (or destroy via a checkout of the old
  script) — same trap as D4.
- Hex body runs at Load: keep the imports-run-nothing invariant test intact
  (`hex()` construction stays inert; only Load executes the body).

## Slice-DoD

The At-a-glance code deploys the live system with zero hand-written wiring; the
fresh deploy serves the round trip on its **first** version (race dead); both
examples on single-Project placement with poisoned defaults verified present;
all gates + invariant guards green; docs already match (built to contract);
PR open (this branch — retitle #10 at DoD), review loop complete.

## Open questions

None pinned open — anything the build forces goes doc-first, as before.

## References

- `docs/design/10-domains/core-model.md` @ `19fb9ef` (contract)
- `docs/design/05-prisma-cloud/pdp-data-model.md` · `alchemy-lowering.md`
- `design-notes.md` decisions 6–7 · plan.md § R4
