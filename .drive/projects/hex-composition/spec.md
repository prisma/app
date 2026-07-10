# System Composition — Project Spec

## Purpose

Make systems reusable components. Concretely: after this project, an Auth system
exists as a workspace package, the storefront-auth example installs it and
consumes it through one typed contract port, and a same-contract fake drops
into the same slot without the storefront changing a line.

## At a glance — the code this project makes possible

The reusable component (new package `examples/auth-system`):

```ts
// examples/auth-system/src/system.ts — the package's main export
import { system } from "@prisma/app";
import { authContract } from "./contract";
import authService from "./service";           // the existing auth service, moved here

export default system("auth", { expose: { verify: authContract } }, ({ provision }) => {
  const db = provision("db", postgres(/* … */));      // the system provisions the resource…
  const api = provision("api", authService, { db });  // …and passes it to the service
  return { verify: api.verify };                      // child's exposed port becomes the system's output
});
// (resource-wiring syntax illustrative — follows the resource-decoupling design;
// packaging a service together with its resource is exactly what a system is for)
```

The app consuming it (`examples/storefront-auth/system.ts` rewritten):

```ts
import authSystem from "@prisma-examples/auth-system";   // installed, workspace:*
import storefrontService from "./systems/storefront/src/service";

export default system("storefront-auth", {}, ({ provision }) => {
  const auth = provision("auth", authSystem);                            // a system, provisioned like a service
  provision("storefront", storefrontService, { auth: auth.verify }); // wired by contract port
  return {};
});
```

The fake (new `examples/storefront-auth/fake/` + an alternate topology file):

```ts
// system.fake.ts — same slot, same contract, no database; storefront untouched
const auth = provision("auth", fakeAuthService);
provision("storefront", storefrontService, { auth: auth.verify });
```

`prisma-app deploy system.ts` deploys the composed topology; `prisma-app deploy
system.fake.ts` deploys (or Load-checks) the faked one. Design contract:
[ADR-0016](../../../docs/design/90-decisions/ADR-0016-a-system-has-the-same-boundary-as-a-service.md)
+ [system-composition.md](../../../docs/design/10-domains/system-composition.md)
(exact signatures, Load rules, addresses).

## What gets built, by file

1. **Core** (`packages/app/src/node.ts`, `graph.ts`):
   - `system(name, { deps?, expose? }, body)` replacing `system(name, body)`;
     `SystemContext` (`inputs` + `provision`), `SystemOutputs`, `InputRef`;
     `SystemNode<D, E>` carrying the boundary types.
   - `provision()` overload accepting `SystemNode<D, E>` → `ProvisionedRef<E>`.
   - Load: recursive flatten; hierarchical dot-joined addresses; four
     validation errors (exact texts in system-composition.md § Load), e.g.:
     `System "auth" declares input "db" but never forwards it into a provision.`
   - Type-level tests (R6 `test-d` pattern) incl. a 3-level nesting case.
2. **Pipeline** (`packages/app-assemble`, `packages/app-cli`,
   `packages/app/src/deploy.ts`):
   - Bundle correlation keys become full addresses (`auth.api`, not `api`)
     through assembly → generated stack file → `lower()` lookup.
   - `${build.pack}/assemble` resolves from `build.module` instead of the
     deploy entry (ADR-0004 as amended) — an installed system's adapter never
     becomes the app's dependency.
3. **The example proof**:
   - New workspace package `examples/auth-system` (`@prisma-examples/auth-system`):
     the existing auth service + contract move in; own `build` script
     producing `dist/server.js`; `@prisma/app*` + `@prisma/app-cloud` as
     peer dependencies (exactly as a published system would declare them).
   - `examples/storefront-auth` rewired per the code above; its
     `systems/auth/` directory dissolves into the package.
   - `fake/` service exposing `authContract` from in-memory state + the
     `system.fake.ts` topology.
   - `.github/workflows/e2e-deploy.yml` keeps deploying `system.ts` — now a
     nested topology — unchanged in shape.

## Non-goals

- Target-neutral systems; shared resources (tree→DAG); system-level params —
  named as extension points in the domain doc, not built here.
- Publishing to the real npm registry (the workspace package exercises the
  same resolution and peer-dep mechanics).
- Changing the resource-provisioning model (see Dependencies).

## Dependencies & coordination

System-composition rebases onto two already-in-flight branches, in order:
- **PR #21 — resource decoupling.** Services declare resource-input slots;
  systems `provision()` resources. **H3 hard-depends on it** — the auth system
  provisions its db at system level and passes it to the service (resources are
  never service-internal). H1/H2 need only ConnectionEnd inputs.
- **PR #22 — always-system root.** The deploy root must be a system; bare services
  are not independently deployable (Load errors with "wrap it in a system"). The
  service-root pipeline path, `examples/prisma-app-hello`, and the e2e hello job
  are already removed on #22's line. Baseline to build against: always-system
  root, bundles-keyed-by-address only. The ADR-0003 amendment for this is
  operator-owned on the #22 line — not ours to edit.

Full rebase facts and the prisma-app-hello/redeploy-noop fallout are in
design-notes.md § Coordination facts.

## Cross-cutting requirements

- Every validation rule is a tested, fix-naming error (the CLI project's
  error-surface standard).
- Compile-time checks primary, Load `satisfies()` backstop; `lint:casts`
  delta ≤ 0; plane-separation and runtime-portability invariants hold
  (composition adds nothing to runtime bundles).
- Doc-first covenant: deviations from ADR-0016/system-composition.md amend the
  doc, never silently diverge.

## Project DoD

- [ ] The three code blocks under "At a glance" compile and run verbatim
      (module specifiers aside) in the repo.
- [ ] CI e2e deploys the composed topology live: nested auth system, storefront
      round trip renders, destroy clean.
- [ ] The fake topology passes typecheck + an integration test driving the
      real CLI through Load; `git diff` between real and fake topologies
      touches no storefront file.
- [ ] Integration test proves an installed package's service can use an
      adapter the consuming app does not declare (build.module-anchored
      resolution).
- [ ] All four Load validation errors exercised by tests asserting message
      content; 3-level nesting type-test green.
- [ ] Gates green; docs match shipped reality.

## Open questions

None. All four held points are resolved: the breaking `system()` reshape and
the validation-rule set are confirmed; the auth system provisions its db at system
level (never service-internal); H3 queues behind the resource-decoupling
landing and adopts its wiring syntax.
