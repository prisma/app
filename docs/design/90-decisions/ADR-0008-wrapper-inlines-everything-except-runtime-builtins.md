# ADR-0008: The boot wrapper inlines everything except runtime built-ins

## Decision

Assembly bundles each service module into `main.mjs`, the boot wrapper that runs
before the app's own entry. That bundle **inlines every import except the hosting
runtime's own modules**: `bun`, `bun:*`, and `node:*` stay external; everything
else — workspace packages, contract libraries, database clients — is bundled in.
There are no per-app bundling options.

A service module is not import-free. A typical one reaches for the target's
vocabulary, a database client factory, and whatever its contracts need:

```ts
// src/service.ts
import { compute, postgres } from "@prisma/composer-prisma-cloud"; // inlined
import { authContract } from "./contract.ts";                      // inlined — and arktype with it
import { SQL } from "bun";                                         // stays external
```

Assembly turns that into a two-part artifact:

```text
.prisma-composer/artifacts/<address>/
├── main.mjs         the wrapper — everything above inlined, except `bun`
└── bundle/
    └── server.mjs   the app's own built entry, copied byte for byte
```

## Reasoning

The wrapper lands beside the app's built output, and that artifact's
`node_modules` holds only what the app's *own* build traced — a Next standalone
tree carries Next's dependencies, not arktype. The wrapper's imports were never
part of that trace. So an import the wrapper doesn't bundle is an import that
isn't there at boot.

Every wrapper import must therefore be either bundled in or provided by the
runtime, and something has to decide which is which. Per-app configuration can't
make that call: the deploy path deliberately has no config file (ADR-0003), so
there is nowhere for an app to declare "also inline these two packages" — and
inventing one for bundling knobs would reopen the door ADR-0003 closed.

The rule has to be general, then, and only one general rule is safe: inline
everything the hosting runtime does not itself provide. Runtime built-ins resolve
inside the deployed VM by definition; nothing else is guaranteed present, so
everything else is bundled. Invert it — externalize by default, inline by
exception — and every new dependency becomes a chance to forget the exception,
with a boot failure as the reminder.

Expressing the rule costs nothing, because it is already how a bundler behaves:
inline whatever resolves, and treat `external` as the only way out. The
implementation is the rule written once — `external: ['bun', 'bun:*']`, with
`node:*` left external by the node platform target — rather than a policy
threaded through the deploy to argue with a tool's defaults.

What remains is a deliberately narrow escape hatch, and the whole boot path
depends on its width, so that width is verified rather than assumed: a test
builds a real wrapper and reads the emitted `main.mjs`. The case that earns the
test is a package whose name merely *begins* with `bun` — it is not a runtime
module, so it must inline, and a widened match like `bun*` would externalize it
while every other property still held.

## Consequences

- **Pure-JavaScript dependencies inline cleanly.** Workspace packages and
  import-time contract libraries need no declarations anywhere.

- **A specifier the bundler can read is checked before anything deploys.** An
  import that cannot be resolved is an error, not a warning: assembly fails,
  names the offending specifier, and emits no `main.mjs`. A wrapper that would
  have died at boot becomes a build that never leaves the machine. Both a static
  `import` and an `import()` of a literal string get this.

- **Native addons do not survive inlining.** A package with `.node` bindings gets
  its JavaScript bundled but not its binary, so it fails at boot rather than at
  assembly. Client factories should stay on pure-JS drivers or runtime built-ins.
  Detecting addon-bearing dependencies during assembly would close this.

- **A computed specifier is invisible to the check.** In `await import(name)`
  with `name` a variable there is no specifier to resolve at build time, so the
  bundler emits the `import()` untouched and the build succeeds with no error and
  no warning — then the wrapper dies at boot on whatever the expression evaluates
  to. Lazy driver loading is written exactly this way. Resolving the reachable
  set during assembly, or rejecting the shape outright, would close this.

- **The wrapper's size tracks the service module's import graph.** Service
  modules are declarations plus client factories by design, so the graph stays
  small — but a service module that imports an application's worth of code will
  get an application's worth of wrapper.

## Alternatives considered

- **Per-app bundling configuration** (an externals/inline list the app declares)
  — no home for it: the deploy path has no config file (ADR-0003), and adding one
  for bundler knobs would be the tail wagging the dog.
- **Deriving the external set from the artifact's `node_modules`** (inline only
  what the app's build didn't trace) — couples the wrapper build to the internals
  of each framework's output tracing, which is exactly the entanglement ADR-0005
  exists to prevent.
- **A curated allow-list of inlinable packages** — a maintenance burden that
  breaks the first time a community app imports something the list hasn't met.

## Related

- [`ADR-0005`](ADR-0005-users-build-the-framework-assembles.md) — the wrapper and
  the assembly boundary it lives behind.
- [`ADR-0003`](ADR-0003-deploy-derives-everything-from-the-root-node.md) —
  why no per-app configuration surface exists.
- [`../10-domains/deploy-cli.md`](../10-domains/deploy-cli.md)
