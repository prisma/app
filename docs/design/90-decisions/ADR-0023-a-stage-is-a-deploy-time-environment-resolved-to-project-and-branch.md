# ADR-0023: A stage is a deploy-time environment; the CLI resolves its Project and Branch before Alchemy

## Status

Accepted

## Decision

A Prisma App is deployed to a named **stage** — an environment such as production,
staging, or a per-PR preview. Stage is a **deploy-plane** concept: the authored
topology is stage-neutral (you write one `system()` graph and deploy it to many
stages), and a stage is chosen at deploy time and lowered to an Alchemy stage running
on a Prisma Cloud **Branch** of the app's single **Project** (per
[ADR-0022](ADR-0022-a-prisma-app-is-one-project-a-stage-is-a-branch.md)).

Before Alchemy runs, the CLI **resolves and ensures two containers**: the app's
**Project** (found or created by the root system's name) and the stage's **Branch**
(found or created). Both are created *outside* Alchemy, because they are the
containers Alchemy's per-stage state is scoped to and cannot be Alchemy resources
themselves. Alchemy then provisions the topology's Services and Resources *within*
that `(Project, Branch)`. Ensuring the app exists is implicit in the first
`prisma-app deploy` (create-if-absent) and also available as an explicit step.

## Reasoning

The concrete goal is mundane and load-bearing: a developer wants to stand up a
**second environment** — a staging deploy, or one isolated environment per pull
request — that mirrors production without disturbing it. On Prisma Cloud an
environment is a **Branch** of the app's Project, carrying its own compute, its own
database, and its own configuration. So "deploy to staging" means: provision the
whole topology into a `staging` Branch, isolated from `production`.

That only works if the app is one Project shared across its environments — which is
exactly [ADR-0022](ADR-0022-a-prisma-app-is-one-project-a-stage-is-a-branch.md). It
also means the environment axis has to enter the model *somewhere*, and the right
place is the **deploy plane**, not authoring. The topology a developer writes has no
notion of environment; the same graph becomes production or a preview depending only
on where it is deployed. So a stage is supplied at deploy time and threaded through
lowering — it never appears in `system()`.

Where a stage lowers to is two things at once: an **Alchemy stage** (which already
gives each environment its own state namespace and physical names) and a Prisma Cloud
**Branch** (which gives it its own compute, database, and config). The Alchemy stage
falls out of the existing machinery; the Branch is the new work.

The subtle part is *who creates the Branch and the Project*. Alchemy provisions by
diffing a desired graph against per-stage state — so it owns the Services and
Resources inside an environment. It cannot own the **Branch**: the Branch is the
container that environment's state is scoped to, and a resource cannot sit inside the
state namespace named after itself. Nor can it own the **Project**: the Project is
shared across *all* the app's environments, and Alchemy state is per-stage, so no
single stage's graph can hold it — putting it in one stage's state would mean
destroying that stage cascades the Project and every other environment with it. Both
containers therefore live *above* the per-stage Alchemy deploy, resolved by the CLI
before the stack runs.

This does not compromise "check out the code and run `prisma-app deploy`." That is a
CLI-orchestration property, not an Alchemy-monopoly one: the single command still does
everything — ensure the Project, ensure the Branch, then run Alchemy for the
resources. The app's **identity is the root system's name** (`system("storefront",
…)` names the Project), so it travels with the code; a bare `prisma-app deploy` from a
fresh checkout, with only a service token, finds-or-creates the `storefront` Project,
ensures its default Branch, and provisions the app. `--name` overrides the derived
name; an explicit Project-id override pins a specific Project when a name is
ambiguous.

Resolving "the app's Project by name" is the same problem the deploy-state store
already solved — duplicate project names, two machines racing to create `storefront`,
squatters — whose answer was *adopt-oldest + an ownership marker*
([ADR-0009](ADR-0009-deploy-state-is-hosted-in-the-workspace.md)). So the two
converge: the **Project resolver is that bootstrap, lifted up a level**, and deploy
state rides as a facet of the Project it resolves rather than a separate discovery
problem — both dissolving once the platform hosts Project identity and state natively.

Finally, production/preview classification stays entirely Prisma Cloud's. The
framework provisions resources and writes configuration *against the resolved
Branch*; it does not set a config `class` and does not assert a branch `role`. Prisma
Cloud assigns the role (today, positionally: the first Branch in a Project is
production, the rest preview) and derives config classification from the Branch. The
framework reasons about neither.

## Consequences

- **Stage becomes a first-class deploy-plane input**, threaded from the CLI through
  lowering to the target pack. The authored topology stays stage-neutral. (Core's
  vestigial, unread `LowerOptions.stage` is superseded by an actually-used one.)
- **Project and Branch creation move out of Alchemy** into a CLI "ensure containers"
  step that runs before the stack. `application.provision` stops *minting* the Project
  inside the stack and instead references the resolved one.
- **One command still deploys from a fresh checkout.** App creation is implicit
  (create-if-absent) by default; an explicit `prisma-app create`-style path shares the
  same resolver.
- **The Project resolver subsumes the deploy-state bootstrap** (name → adopt-oldest or
  create + ownership marker), consistent with targets supplying the state layer
  ([ADR-0011](ADR-0011-targets-supply-the-deploy-state-layer.md)).
- **Deploy state is per `(Project, Branch)`**, which Alchemy's per-stage state already
  segregates; the store's *location* is unchanged by this decision.
- **Config `class` becomes mechanical, never a decision.** The default (production)
  environment writes config as today — no `branchId`, `class: production`. A named stage
  writes config against its `branchId` with `class: preview` (the platform bars a
  production-class branch override). The pack computes `class = branchId ? 'preview' :
  'production'` from `branchId` presence — never from a Branch `role` lookup. The cleaner
  end-state — the pack sends only `branchId` and the platform derives `class` — needs a
  Management-API change and is deferred. (This is our provisioning path via Alchemy +
  Management-API resources; the platform's own role-gated deploy jobs are not in play.)
- **The Project-id override reuses the existing config file.** Name-derived identity is
  the default; when it is insufficient, a project pins an explicit Project-id override in
  the app's `prisma-app.config.ts`, which
  [ADR-0017](ADR-0017-control-plane-loads-through-the-app-config.md) already establishes —
  so this needs no new config surface, and
  [ADR-0003](ADR-0003-deploy-derives-everything-from-the-root-node.md)'s "derive from the
  root node" bias is preserved (the config file is the escape hatch, not the default path).

## Alternatives considered

- **One Project per stage** (the pre-ADR-0022 shape). Each environment its own Project.
  Rejected: no Project represents the whole app, so environments don't share anything
  and the platform never sees "app X's environments"; and it is simply the model
  ADR-0022 already rejected, re-expressed.
- **Branch (and Project) creation inside Alchemy.** Rejected: the Branch is the
  container its own state is scoped to, and the shared Project cannot belong to any one
  stage's state without a stage-destroy cascading the whole app. Container lifecycle is
  necessarily above the per-stage deploy.
- **The framework sets config `class` / branch `role` explicitly.** Rejected as not the
  framework's concern — production/preview is a Prisma Cloud property. Setting `role`
  explicitly is additionally impossible today (`POST /v1/projects/:id/branches` rejects
  `role` as server-owned); we accept the positional default and defer explicit control
  until it is needed.

## Open questions / deferred

- **Explicit branch role.** Accepted as the platform's positional default (first Branch
  = production). Explicit control needs a `role` input the branches API does not offer
  today; deferred until it bites.
- **Preview-branch data.** A fresh environment's Postgres is created empty and brought
  to the aggregate contract by the existing migration mechanism; copy-on-write /
  realistic data is a platform capability under discussion (PDP's compute-branching),
  deferred.
- **Platform-native state + Project identity.** The Project resolver and its ownership
  marker are the interim; both dissolve when the platform hosts Project identity and
  deploy state natively (the workspace state-API direction in ADR-0009's end state).

## Related

- [ADR-0022](ADR-0022-a-prisma-app-is-one-project-a-stage-is-a-branch.md) — App = one
  Project, Stage = Branch; the mapping this decision operationalizes.
- [ADR-0009](ADR-0009-deploy-state-is-hosted-in-the-workspace.md) — the deploy-state
  bootstrap the Project resolver repurposes.
- [ADR-0003](ADR-0003-deploy-derives-everything-from-the-root-node.md) — derive-from-root
  stays the default; the config-file override is the escape hatch.
- [ADR-0017](ADR-0017-control-plane-loads-through-the-app-config.md) — the
  `prisma-app.config.ts` the Project-id override reuses.
- `docs/design/03-domain-model/glossary.md` — Stage → Environment; the authoring planes.
