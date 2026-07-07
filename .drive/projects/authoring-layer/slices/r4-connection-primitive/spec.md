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
  artifacts: { auth: authArtifact, storefront: storefrontArtifact },
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
  deploy outputs → writeConfig → deploy); `LowerOptions.artifacts` map; hex
  roots in `lowering()`/`lower()`.
- **pack**: `http()` + default fetch client (app-factory override);
  `prismaCloud()` reshaped per the worked instance — `application.provision`
  (Project + **poison `DATABASE_URL`/`DATABASE_URL_POOLED`**, empty-string value
  with `"-"` fallback), `resources.postgres` → real `Database` + `Connection`,
  `services.compute` → provision (App) / writeConfig (per-service named keys via
  the one shared mapping module + the reserved service-identity variable) /
  deploy (Deployment with `environment` prop).
- **prisma-alchemy**: `Deployment` gains the `environment` prop (env-var record
  refs — the ordering/propagation edge). In scope by design decision.
- **examples**: both migrate to single-Project placement. storefront-auth gains
  the app hex; `alchemy.run.ts` shrinks to the three-liner; storefront declares
  `auth: http()`. makerkit-hello: same placement, explicit db variable.
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
- Boot-side key reconstruction: the adapter needs the service's own identity to
  build its prefixed keys — writeConfig records the reserved identity variable;
  boot reads it first.
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
