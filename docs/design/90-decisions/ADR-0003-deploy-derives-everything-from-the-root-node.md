# ADR-0003: `makerkit deploy` derives everything from the root node — there is no deploy config file

## Status

Accepted. Amended (this revision): `pack` now lives on one shared base type
for pack-authored nodes (service + resource — see `core-model.md`'s
`PackAuthoredNode`), and `type` is the node's own unqualified discriminant
(e.g. `"postgres"`, `"compute"`, never `"prisma-cloud/postgres"`). This does
not change the reasoning below — inference always read `pack`, never `type`
— it only makes explicit that the two are separate axes: `pack` selects the
target, `type` routes within it (the target's own lowering tables, e.g.
`Target.resources`/`Target.services`, key on the bare `type`).

## Decision

The deploy entrypoint is `makerkit deploy [entry]`, where `entry` is a module
whose default export is a node (a service or a hex). Everything else is derived:
the application is the graph reachable from that node, the deployment target is
inferred from the nodes themselves and constructed from the environment, and the
application name comes from the root node (overridable with `--name`). There is
no `makerkit.config.ts`.

## Reasoning

An earlier sketch of the deploy path had a declarative config file exporting
`{ app, target, name }`. Walking through what each field actually carries
dissolves it:

- **`app`** is redundant — it's just an import of the root module. The CLI can
  take that module's path directly.
- **`name`** belongs on the root node itself (see ADR-0006), with a `--name`
  flag for overrides (CI needs per-run ephemeral names).
- **`target`** was the only real content. It lives outside the app module for an
  architectural reason: target construction is code (`prismaCloud({ workspaceId })`)
  and its import is heavy and deploy-only, so the bundle-safe app module can
  never contain it. *Some* deploy-side code must construct the target — but that
  code can be the CLI itself.

Two facts make CLI-side target construction workable. First, the target is
inferable: every node already carries its pack's identity (the factories that
made it came from the pack), so the CLI can read the pack off the loaded graph
and dynamically import that package's `/target` entry. To keep this robust the
node carries the pack's **package name** — not a slug that needs a naming
convention to resolve — so community packs resolve identically to first-party
ones. Second, the target's options are environment-shaped in practice
(`workspaceId` from `PRISMA_SERVICE_TOKEN`-adjacent env), so the pack's `/target`
entry exposes a conventional construct-from-environment export — `fromEnv():
Target` — that reads its own variables and fails with an error naming any
missing one. A graph whose nodes come from more than one pack is an error for
now (one target per application).

Inference cannot silently pick a wrong target: `lower()` routes every node type
through the target's lowering tables, so a mismatch fails immediately with a
`LowerError` naming the unknown type.

Dropping the config file also settles what "the root" means: **nothing marks a
root in the model**. Whatever module you point the CLI at *is* the application,
and the graph reachable from its default export is what deploys. Two cases fall
out:

- A **self-contained service** (all inputs satisfied by its own resources)
  deploys as a complete standalone application — its own Project, its own
  state. This is a feature (deploy one slice in isolation), and it cannot
  collide with the composed app: it needs its own explicit name, hence its own
  Project and Alchemy state.
- A service with **unwired connection inputs** (one normally wired by an
  enclosing hex's `provision`) fails at Load, with an error naming the unwired
  input and pointing the user at deploying the composing hex instead.

## Consequences

- The standard deploy is zero-config: `makerkit deploy src/service.ts` plus
  environment variables.
- Target packs gain a small CLI-facing contract: nodes carry the pack's package
  name, and the `/target` entry exports `fromEnv()`. This is the new seam this
  decision creates.
- One target per application, for now. Multi-target or heavily parameterized
  setups have no home until an escape hatch exists; a config file (or flags)
  can be reintroduced later as the *optional override*, not the standard path.
- `lower()` in `@makerkit/core/deploy` remains the mechanism and the escape
  hatch for hand-composed / mixed Alchemy stacks.
- The Load error for unwired inputs becomes user-facing surface and must be
  clear about what to do.

## Alternatives considered

- **Declarative `makerkit.config.ts` (`{ app, target, name }`)** — the original
  sketch. Rejected: every field is derivable, and the file drifts toward being
  a second place that names the app, against "your code is the source of
  truth". Remains available as a future opt-in override.
- **Target named by CLI flag** (`--target @makerkit/prisma-cloud`) — workable
  but redundant: the nodes already know their pack, and a flag can disagree
  with them.
- **Slug-based inference** (type prefix `prisma-cloud/…` → `@makerkit/prisma-cloud`)
  — breaks for community packs; carrying the package name on the node costs one
  field and removes the convention.

## Related

- [`ADR-0004`](ADR-0004-service-nodes-carry-their-authoring-url.md) — how the
  CLI locates each service on disk.
- [`ADR-0005`](ADR-0005-users-build-makerkit-assembles.md) — the build/assembly
  ownership split the CLI drives.
- [`ADR-0006`](ADR-0006-every-node-is-named.md) — where the application name
  comes from.
- [`../10-domains/deploy-cli.md`](../10-domains/deploy-cli.md) — the full
  pipeline this decision anchors.
