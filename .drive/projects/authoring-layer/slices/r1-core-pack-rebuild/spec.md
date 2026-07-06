# Slice R1 — core + pack rebuild, proven on the minimal example

## At a glance

```ts
// examples/makerkit-hello/src/service.ts
import { compute, postgres } from "@makerkit/prisma-cloud"
import type { SQL } from "bun"                       // the APP's client choice

export default compute({ db: postgres<SQL>() }, ({ db }, { port }) =>
  Bun.serve({ port, hostname: "0.0.0.0",
    fetch: async () => Response.json(await db`select 1 as ok`) }))
```

Deploys via `lower(service, prismaCloud({ workspaceId }), { name, artifact })`,
runs via the app's `main.ts` calling
`runHost(service, runtime({ clients: { postgres: ({ url }) => new SQL({ url }) } }))`,
bundled by the app with tsdown. MakerKit imports no target, ships no bundler, no
driver, no runtime API.

## Chosen design

[`docs/design/10-domains/core-model.md`](../../../../../docs/design/10-domains/core-model.md)
**is the contract** — types, six entries, dependency weights, the five invariants,
the worked pack source, and the `lowering()` composable form. Any deviation found
during the build amends the design doc with the operator first.

## Coherence rationale

One PR (reworking [PR #6](https://github.com/prisma/makerkit/pull/6) in place):
mostly a restructuring of already-reviewed code — Load/graph mechanics, tests, and
the prisma-alchemy resource mapping survive; what moves is *where things live*
(vocabulary + lowering table + hydrators into the pack) and what disappears
(`/build`, core's target import). One reviewer can hold "does the built surface
match core-model.md" in one sitting.

## Scope

**In:**
- `packages/makerkit-core` rebuilt: `.` (factories `service`/`resource`, `Load`,
  model types), `/lower` (`lowering` + `lower` router, `Target` types), `/runtime`
  (`runHost`, `TargetRuntime` types). Delete `/build` and the old target-coupled
  `lower`/descriptors/host.
- `packages/makerkit-prisma-cloud` (npm `@makerkit/prisma-cloud`): `.`
  (`compute`/`postgres<C>()`), `/target` (`prismaCloud()` — the only place
  `prisma-alchemy` is imported), `/runtime` (`runtime({ clients })`).
- `examples/makerkit-hello` reworked: `src/service.ts`, `src/main.ts` (driver
  import lives here), tsdown bundle + app build script writing
  `compute.manifest.json` + tar, `alchemy.run.ts` via `lower(...)`.
- The five invariant guard tests (core-model § Invariants) + unit tests for
  factories/Load/lowering-routing/runHost.
- Deploy → live `select 1` → destroy on real Prisma Cloud (final dispatch).
- PR #6 retitle/re-describe at DoD.

**Out (deliberately):** storefront-auth migration (R2); Connections/interfaces/
hex; any `prisma-alchemy` changes (the `providers()` cast stays, commented, in the
pack); framework DI.

## Pre-investigated edge cases

- `import { SQL } from "bun"` in `main.ts`: tsdown must mark `bun` **external**
  (runtime built-in, unresolvable at bundle time).
- Import-split guard tests must assert the probe build **succeeded** before
  asserting on tokens (vacuous-pass trap caught in the prior review).
- "Importing runs nothing" needs a fixture module with an exported side-effect
  counter (inline construction doesn't test module evaluation).
- The `providers()` structural-typing gap: exactly one commented cast, in the
  pack's `prismaCloud()`, never in core.
- Compute is scale-to-zero: verification retries ~15s of 502 before 200.
- `artifactHash` in Deployment props is what makes a rebuild register as a change
  — the app build script must emit the tarball sha256 for `alchemy.run.ts`.

## Slice-DoD

Everything in plan.md R1 **Outcome**, plus: all five invariant tests green;
`packages/makerkit-core/package.json` names no `prisma-*`/runtime package; gates
(`typecheck`, `test` for both packages; example typecheck + artifact build) green.
CI-green + reviewer-accept + project-DoD floor inherited.

## Open questions

None — settled in the project spec and core-model.md.

## References

- `docs/design/10-domains/core-model.md` (contract) ·
  `docs/design/03-domain-model/core-and-targets.md` ·
  `docs/design/01-principles/architectural-principles.md`
- Prior build + review: PR #6 history, `.drive/projects/authoring-layer/reviews/`
  (local), `design-notes.md` decision history.
