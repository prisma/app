# ADR-0004: Every path resolves relative to the file that writes it — the build adapter carries the authoring module

## Status

Amended (this revision) — supersedes the original nearest-`package.json`
anchor decision below. The service node no longer carries `url`; the
authoring module moved to the build adapter descriptor, and every path on
that descriptor resolves relative to it directly, with no directory
discovery. The ADR number and its cross-references are unchanged; the
original decision is kept underneath for history.

## Decision (current)

The build adapter descriptor — not the service node — carries the authoring
module: `node({ module: import.meta.url, entry: '../dist/server.js' })`,
`nextjs({ module: import.meta.url, appDir: '..', entry: 'server.js' })`.
`entry` (and any other kind-specific path field, e.g. nextjs's `appDir`)
resolves relative to `dirname(module)` — exactly like a relative import
specifier. There is no discovery step: no walk to a nearest `package.json`,
no notion of a "service directory" distinct from the module that authored the
descriptor. `ServiceNode` no longer has a `url` field at all.

The CLI mirrors the same rule at its own layer: it resolves a pack's `/target`
or `/assemble` subpath by seeding `createRequire` with the entry module's own
file path — not a discovered package directory — and lets Node's resolver
walk `node_modules` upward on its own (that walk is the platform's, not
ours). The generated `.makerkit/alchemy.run.ts` and Alchemy's own state live
in the process's working directory: tool state lives where you run the tool,
like any other CLI, not at some directory the tool infers.

## Reasoning (current)

The nearest-`package.json` anchor (below) bent the "no machine paths on
nodes" rule for one field (`url`) and asked the CLI to rediscover a directory
from it before any path on the build adapter meant anything. That indirection
paid for nothing: the descriptor's `entry` was always going to be authored in
the same file as the node it describes, so the file that already knows where
the built output lives is the file being edited right now. Reading that
path the way every other import specifier in the file is read — relative to
the current module — removes a resolution step and a whole error class (no
`package.json` found above the module) without losing anything: a service
still is not tied to a one-service-per-package layout, because `dirname` of
whatever module authored the descriptor is exactly as flexible an anchor as
a discovered package directory, and considerably more explicit about what it
anchors.

Moving the field to the build adapter (rather than keeping `url` on the
service node and just changing what the CLI does with it) also does a second
job: it was carrying two different concerns under one name. A service
composes multiple resources and connections that have nothing to do with
"where do I find this service's build output" — only the build adapter cares
about that question, so only the build adapter needs the authoring module.
The service node itself needed no anchor of its own once nothing walks up
from it.

The CLI-level counterpart (seeding `createRequire` with the entry file
instead of a discovered `package.json`) follows the same logic one layer up:
`createRequire(file).resolve(...)` already walks `node_modules` upward from
`dirname(file)` — that is Node's own module resolution algorithm, identical
to what happens for a plain `import` in that file. Discovering the nearest
`package.json` ourselves and building a synthetic anchor from it was
reimplementing a piece of the platform's own resolver for no benefit; the
entry file is already exactly the right file to seed it with.

## Consequences

- `service()`/`compute()` no longer take a `url` parameter — one line of
  authoring boilerplate removed, in exchange for the build adapter needing
  its own `module` (already being authored at the same call site, alongside
  `entry`).
- The build adapter's `module` bends the "no machine paths" rule the same
  way `url` used to — the sanctioned exception now lives in `BuildAdapter`'s
  own doc, not `ServiceNode`'s.
- A service authored with no reachable built output at
  `dirname(module)/entry` fails at assemble with a "run your build" error
  naming the resolved path — there is no separate "no package anchor" failure
  mode anymore, because there is no anchor to fail to find.
- `.makerkit/` and Alchemy's state land wherever the tool is invoked from,
  matching every other CLI's convention. CI and the example package scripts
  already run `makerkit deploy`/`destroy` with cwd set to the app's own
  directory, so this is unchanged in practice — it is the *reason* it works,
  made explicit rather than incidental.
- The serialized-topology emit (future) must strip or relativize
  `build.module`; it is machine-specific and doesn't belong in a shareable
  artifact — the same requirement the superseded decision named for `url`.

## Alternatives considered (current)

- **Keep `url` on the service node, change only what the CLI does with it**
  — rejected: the CLI-side directory walk is only half the indirection: the
  node still needed a `url` field for a concern (build output location) that
  belongs to the build adapter, not the service.
- **A `serviceDir` parameter passed explicitly at assembly** — equivalent
  information to `dirname(module)`, but redundant: the module already
  determines the directory, and asking authors to state both invites drift
  between them.

## Related

- [`ADR-0003`](ADR-0003-deploy-derives-everything-from-the-root-node.md)
- [`ADR-0005`](ADR-0005-users-build-makerkit-assembles.md) — what assembly does
  with the resolved paths.
- [`../10-domains/deploy-cli.md`](../10-domains/deploy-cli.md)

---

## Original decision (superseded)

### Status

Accepted (2025 — superseded by the amendment above)

### Decision

Every service factory takes the authoring module's URL:
`compute({ url: import.meta.url, … })`. At deploy, the CLI resolves a service's
directory from that URL by walking up to the **nearest `package.json`** —
that directory is the anchor against which the build adapter's `entry` paths
resolve. The field is deploy-time metadata only; nothing reads it at runtime.

### Reasoning

Assembly needs to know where each service lives on disk: the adapter's `entry`
("the built runnable is at `dist/server.js`") is relative to *something*, and
for a hex composing services from several directories, nothing in the model
carried that something. The graph is plain data; nodes have no back-reference
to the files that authored them.

The alternatives were inference (loader hooks or stack-trace capture in the
factory — magic, and fragile across runtimes) or declaration at the composition
site (`h.provision` taking paths — wrong place, since the hex shouldn't know
its children's layout). One explicit parameter at the service factory is boring
and robust: `import.meta.url` is evaluated in the authoring module, survives
any import path to the node, and makes the requirement a compile error rather
than a deploy-time surprise.

The nearest-`package.json` convention turns one input into the answer assembly
needs, without imposing project-layout rules. It is deliberately **not** a
one-service-per-package rule: two services in one package share the anchor and
name distinct entries (`dist/auth/server.js`, `dist/billing/server.js`).
The package boundary is a *resolution anchor*, not a service identity.

The field bends the "no machine paths on nodes" rule acceptably. Nodes ride
into runtime bundles, but bundlers preserve `import.meta.url` as an
*expression*, not a literal — inside the deploy artifact it re-evaluates to an
artifact-internal path that nothing reads. No dev-machine path is baked in, so
artifacts stay byte-deterministic. We considered a dead-code-branch pattern to
strip the field from user bundles and rejected it: the branch would live in
user source and the stripping in the user's bundler config, which MakerKit
does not control — so correctness must never depend on it. Deploy-only fields
are designed to be inert garbage at runtime instead.

### Consequences

- `url` becomes a required parameter of every service factory — one line of
  boilerplate per service, in exchange for zero inference machinery.
- The serialized-topology emit (future) must strip or relativize the URL; it is
  machine-specific and doesn't belong in a shareable artifact.
- The node-model documentation's "no machine paths" rule gains its one
  exception, named explicitly.
- A service authored outside any package (no `package.json` above it) has no
  anchor and fails at deploy with a clear error.

### Alternatives considered

- **Loader-hook / stack-trace inference** — zero boilerplate, but runtime-
  dependent magic (source maps, bun vs node stack formats) for something that
  must never mislocate a deploy.
- **Paths declared at `h.provision`** — puts a child's filesystem layout in the
  parent's wiring code and doesn't help the single-service root at all.
- **One-service-per-package rule** — would let the package *be* the service
  identity, but imposes a repo layout MakerKit has no business dictating.

**Why this was superseded:** in practice, the anchor's own directory was
always going to be `dirname` of the same authoring module `url` already
carried — the walk to a `package.json` bought no additional flexibility over
reading paths relative to the file that wrote them, and it cost the CLI a
directory-discovery step (and its own error mode) that the amendment removes
entirely. See the current decision above.
