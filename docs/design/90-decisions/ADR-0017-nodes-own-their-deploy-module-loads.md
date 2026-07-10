# ADR-0017: Nodes own their deploy-module loads

## Status

Accepted

## Decision

A node carries, as author-written data, the full module specifier of each
deploy-only module it needs — a service or resource carries `targetModule`
(e.g. `"@prisma/app-cloud/target"`), a build adapter carries `assembler`
(e.g. `"@prisma/app-node/assemble"`) — and exposes a method that loads it:
`node.loadTarget()`, `node.assemble()`. The method performs a dynamic
`import()` whose argument is the stored specifier, read from the instance. The
deploy tooling asks the node; it never constructs a specifier from parts,
resolves a specifier to a filesystem path, or anchors resolution at a chosen
file.

## Reasoning

Start from what the deploy tooling needs and cannot do. To deploy, it must load
two kinds of heavy, deploy-only module: a pack's `/target` (the provisioning
engine) and each service's build adapter's `/assemble` (a bundler). The CLI
depends on no pack — that is deliberate, so `prisma-app` ships knowing nothing
about `@prisma/app-cloud` or any community pack — so the CLI can never name one
in a static `import`. Something that *does* know the package has to do the load.

The node knows. A pack-authored node was created by that pack's factory, and the
factory writes the specifier onto the node:

```ts
// @prisma/app-node — the build adapter carries its own assembler's specifier
const ASSEMBLER = "@prisma/app-node/assemble";
export default (opts) => ({ kind: "node", assembler: ASSEMBLER, ...opts });

// @prisma/app — the node performs the load for the framework
class ServiceNode extends Node {
  loadAssembler() { return import(this.build.assembler); }
  async assemble(opts) {
    const { assemble } = await this.loadAssembler();
    return assemble({ build: this.build, ...opts });
  }
}
```

At deploy the CLI loads the graph, then asks: `node.assemble()` for each
service, and `node.loadTarget()` then `fromEnv()` for the one target. The
correlation between a node and its deploy-only code is the node's own data,
loaded through the platform's own `import` — no `createRequire`, no
`require.resolve`, no path, no anchor file.

**Why the specifier is data and the import takes a variable.** This is a
mechanical requirement, not a stylistic one. A pack-authored node rides into the
deployed artifact: the authoring module is bundled to build the wrapper, and
that build inlines `@prisma/*` (ADR-0008). A bundler follows an `import()` whose
argument is a static string literal. So a factory that literally wrote
`import("@prisma/app-node/assemble")` would have its assembler — and the whole
bundler it pulls in — followed into the production artifact. Storing the
specifier as a field and loading it through `import(this.build.assembler)` — a
*variable* argument — is opaque to the bundler, so the deploy-only module never
enters the runtime bundle. Each pack carries a test asserting no static
`import()`/`require()` of a `/target` or `/assemble` literal appears in its
shipped source, and that an actual wrapper build of its authoring surface
contains none of the control-plane tokens (`alchemy`, the driver, `bun`) the
deploy-only module would drag in.

**How resolution lands.** `import(this.targetModule)` resolves relative to the
module the expression is written in — `@prisma/app` (core) — so the pack must be
reachable by the platform's normal upward `node_modules` walk from core's
install location. That is guaranteed two ways: the app depends on the pack
directly (it appears in the app's own `node_modules`), or the package manager
hoists it there (pnpm's default). It is **not** guaranteed by a peer-dependency
declaration — core declares none on packs. One residual gap follows: a pack
needed *only* transitively by an installed system, under a package manager
configured to disable hoisting, is not visible from core's anchor. The
resolution-failure error still names the fix ("the app, or the system package that
brought this service, must depend on the package"), which is correct for a
direct dependency but not for that strict-isolation configuration. Closing it
would require resolving from the system's own location rather than core's — a
future refinement, not part of this decision.

**Identity is unaffected.** Nodes became classes to carry these methods, but
identity still rides the `Symbol.for("prisma:node")` brand that `isNode()`
checks — never `instanceof`. A node built by a different installed copy of core
(which an installed system can bring) still validates. The classes are a carrier
for behavior, not the identity mechanism.

## Consequences

- A build adapter's `assembler` field replaces `build.pack`; service and
  resource nodes gain `targetModule`. `node.pack` remains only where an error
  message names a package; it drives no resolution.
- The CLI-side path resolver (`createRequire` anchored at the entry module) is
  deleted. Target inference collects the distinct `targetModule` values across
  the graph, requires exactly one, and asks a node to load it — the same
  zero/one/many semantics the pack-name collection had.
- Each pack ships a firewall test (above). This is the guard that keeps the
  deploy-only module out of the runtime artifact; it must not be weakened.
- The generated stack file (`.prisma-app/alchemy.run.ts`) may `import` the target
  by a literal specifier — it is written to the working directory and run by
  Alchemy at deploy, never bundled into the wrapper, so it does not breach the
  firewall.
- A published system resolves its own adapters and target the same way, provided
  the packs it uses are reachable from the app (direct dependency or default
  hoisting) — see the resolution caveat above.

## Alternatives considered

- **The CLI constructs `${pack}/target` and resolves it to a path** via
  `createRequire` seeded with the entry module's file (the prior design). It
  worked, but it made the framework do the author's import for them: it
  constructed specifiers from a `pack` field, resolved them to filesystem paths,
  and needed a chosen anchor file — and anchoring at the deploy entry could not
  reach a build adapter that an installed system kept internal. Replaced by letting
  the node load itself.
- **A loader thunk on the node that imports a literal**
  (`loadAssembler: () => import("@prisma/app-node/assemble")`). Reads cleanly,
  but the literal lives in factory code that ships inside the wrapper bundle, so
  the bundler follows it and drags the assembler into the runtime — the exact
  failure the firewall exists to prevent. Rejected. The specifier must reach
  `import()` as a variable.
- **Load the packs from the generated stack file** rather than from the node.
  Also path-free and firewall-safe (the stack file is deploy-only), but it moves
  the load out of the CLI's graph walk and into generated code. Keeping "load
  the graph, then ask the nodes" — the tooling holds node objects and calls
  their methods — was preferred as the simpler control flow.

## Related

- [`ADR-0003`](ADR-0003-deploy-derives-everything-from-the-root-node.md) — target
  inference; the node-owned load is how the inferred target is obtained.
- [`ADR-0008`](ADR-0008-wrapper-inlines-everything-except-runtime-builtins.md) —
  the wrapper inlining that makes the firewall necessary.
- [`ADR-0004`](ADR-0004-paths-resolve-relative-to-the-authoring-file.md) — the
  `build.module` path rule this decision leaves untouched (assembler *paths*
  inside a bundle still resolve file-relative; the assembler *module* is now
  node-loaded).
- [`../10-domains/deploy-cli.md`](../10-domains/deploy-cli.md) — the pipeline and
  the seams this reshapes.
