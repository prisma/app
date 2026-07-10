# ADR-0017: Nodes own their deploy-module loads

## Status

Accepted

## Decision

A node carries the full module specifier of each deploy-only module it needs, as
author-written data — a service or resource carries `targetModule` (e.g.
`"@prisma/app-cloud/target"`), a build adapter carries `assembler` (e.g.
`"@prisma/app-node/assemble"`) — and exposes a method that loads it:
`node.loadTarget()`, `node.assemble()`. The method's dynamic `import()` takes
that stored specifier, read from the instance. The deploy tooling asks the node;
it never builds a specifier from parts, resolves one to a filesystem path, or
anchors resolution at a chosen file.

## Reasoning

Start from what the deploy tooling needs but cannot do itself. To deploy, it
must load two heavy, deploy-only modules: a pack's `/target` (the provisioning
engine) and each service's build adapter's `/assemble` (a bundler). The CLI
deliberately depends on no pack — `prisma-app` ships knowing nothing about
`@prisma/app-cloud` or any community pack — so it can never name one in a static
`import`. Whatever loads these modules has to already know the package.

The node knows: a pack-authored node was created by that pack's factory, and the
factory writes the specifier onto it.

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

So deploy is "load the graph, then ask each node": `node.assemble()` for each
service, and `node.loadTarget()` then `fromEnv()` for the one target. A node's
correlation to its deploy-only code is the node's own data, loaded through the
platform's own `import` — no `createRequire`, no `require.resolve`, no path, no
anchor file.

**Why the specifier is data, and the import takes a variable.** This is
mechanical, not stylistic. A pack-authored node rides into the deployed
artifact: the authoring module is bundled to build the wrapper, and that build
inlines `@prisma/*` (ADR-0008). A bundler follows an `import()` with a static
string-literal argument — so a factory that literally wrote
`import("@prisma/app-node/assemble")` would pull its assembler, and the whole
bundler that assembler imports, into the production artifact. Holding the
specifier as a field and loading it through `import(this.build.assembler)` — a
*variable* argument — is opaque to the bundler, so the deploy-only module never
enters the runtime bundle. Each pack carries a test that fails if a static
`/target` or `/assemble` literal appears in its shipped source, and that a real
wrapper build of its authoring surface contains none of the control-plane tokens
(`alchemy`, the driver, `bun`) such a module would drag in.

**How resolution lands.** `import(this.targetModule)` resolves relative to the
module the expression is written in — `@prisma/app` (core) — so the pack must be
reachable by the platform's normal upward `node_modules` walk from core's
install location. That holds when the app depends on the pack directly (it sits
in the app's own `node_modules`) or the package manager hoists it there (pnpm's
default); it is *not* guaranteed by a peer-dependency declaration, and core
declares none on packs. One gap follows: a pack needed only transitively by an
installed system, under a package manager configured to disable hoisting, is not
visible from core's anchor. The resolution error still names the fix — "the app,
or the system package that brought this service, must depend on the package" —
which is right for a direct dependency but not for that strict-isolation setup.
Closing it would mean resolving from the system's own location rather than
core's; that is a possible future refinement, not part of this decision.

**Identity is untouched.** These methods live on node classes, but identity
still rides the `Symbol.for("prisma:node")` brand that `isNode()` checks — never
`instanceof` — so a node built by a different installed copy of core (which an
installed system can bring) still validates. The classes carry behavior; the
brand carries identity.

## Consequences

- A build adapter carries `assembler`; a service or resource node carries
  `targetModule`. `node.pack` remains only where an error message names a package
  — it drives no resolution.
- The CLI resolves no paths. Target inference collects the distinct
  `targetModule` values across the graph and requires exactly one: none is an
  error (nothing to deploy against), more than one is an error (mixed targets),
  and the single value is loaded by asking a node that carries it.
- Each pack ships the firewall test above. It is the guard that keeps deploy-only
  modules out of the runtime artifact, and must not be weakened.
- The generated stack file (`.prisma-app/alchemy.run.ts`) may `import` the target
  by a literal specifier: it is written to the working directory and run by
  Alchemy at deploy, never bundled into the wrapper, so it does not breach the
  firewall.
- A published system resolves its own adapters and target the same way, as long
  as the packs it uses are reachable from the app (direct dependency or default
  hoisting) — subject to the resolution gap above.

## Alternatives considered

- **Have the CLI construct `${pack}/target` and resolve it to a filesystem path**
  (via `createRequire` seeded at the entry module). It makes the framework do the
  author's import for them — building specifiers from a `pack` field, resolving
  them to paths, and choosing an anchor file — and, anchored at the deploy entry,
  it cannot reach a build adapter that an installed system keeps internal.
- **Put a loader thunk with a literal import on the node**
  (`loadAssembler: () => import("@prisma/app-node/assemble")`). Reads cleanly,
  but the literal lives in factory code that ships inside the wrapper bundle, so
  the bundler follows it and drags the assembler into the runtime — the exact
  failure the firewall prevents. The specifier has to reach `import()` as a
  variable.
- **Load the packs from the generated stack file** instead of from the node.
  Also path-free and firewall-safe (the stack file is deploy-only), but it moves
  the load out of the CLI's graph walk into generated code; holding node objects
  and calling their methods is the simpler control flow.

## Related

- [`ADR-0003`](ADR-0003-deploy-derives-everything-from-the-root-node.md) — target
  inference; the node-owned load is how the inferred target is obtained.
- [`ADR-0008`](ADR-0008-wrapper-inlines-everything-except-runtime-builtins.md) —
  the wrapper inlining that makes the firewall necessary.
- [`ADR-0004`](ADR-0004-paths-resolve-relative-to-the-authoring-file.md) — the
  `build.module` path rule this decision leaves untouched: paths *inside* a
  bundle still resolve file-relative; the assembler *module* is node-loaded.
- [`../10-domains/deploy-cli.md`](../10-domains/deploy-cli.md) — the pipeline and
  the seams this reshapes.
