# ADR-0022: A Prisma App is one Project; a Stage is a Branch

## Status

Accepted

## Decision

A Prisma App lowers to a single Prisma Cloud **Project**. The Systems inside it
become the Project's **Apps** (compute services) and **Databases** — siblings under
one Project, not projects of their own. Each deployment environment — production, or
a per-git-branch preview — is a **Branch** of that Project, and the resources,
configuration, and deploy state of an environment are scoped to its Branch.

The single-Project mapping is already how the Prisma Cloud target provisions; this
record fixes it deliberately and settles the environment axis: a **Stage is a
Branch**.

## Reasoning

Prisma Cloud's resource hierarchy is Workspace → Project → Branch → { App,
Database }. A Branch is an environment keyed to a git branch: the first branch of a
Project is production, later branches are previews, and each Branch carries its own
Apps, Databases, and configuration. The shape that matters is where Branch sits — it
is *between* the Project and the compute/data resources. So the unit you branch is
the **Project**, and the Apps and Databases are the per-branch things that fork with
it.

Now take the operation that makes this concrete: a developer opens a pull request and
wants a preview of her change. What she wants previewed is the *whole app* — every
System, its data, and the wiring between them — stood up in isolation from
production so she can click through the running change. Branching a Project delivers
exactly that: one action forks the entire set of Apps and Databases under it into a
new Branch, with its own per-branch configuration, and tears down together when the
branch closes.

That only works if the whole app is one Project. Were each System its own Project,
there would be no single thing to branch. A preview would mean creating a parallel
Branch in every one of the app's Projects and coordinating them — matching names,
rewiring every cross-System connection to point at the right branch's endpoints,
destroying them in concert. The platform would never see "one app, previewed"; it
would see N projects that each happen to have a branch, and the branch unit — the
thing that makes PR previews and per-branch configuration a one-click platform
capability — would be unavailable at the level that matters, the app.

So a Prisma App is one Project, and a Stage is a Branch. Each System lowers to an App
(a compute service — already the `Service → ComputeService + Deployment` target) plus
its Databases, all siblings under the Project. The configuration and
graph-materialized wires the framework injects become the Branch's ConfigVariables.
And deploy state, which the engine keys by `(stack, stage, resource)`, is naturally
per `(Project, Branch)`: the Project is the stack, the Branch is the stage.

This also makes native a goal the framework already holds — reproduce the whole
topology in a fresh environment. A Branch *is* that reproduction, its own data and
all.

## Consequences

- **This is largely the current mapping, now fixed by decision.** The Prisma Cloud
  target already provisions one Project per app and creates each System's Database and
  ComputeService inside it, writing configuration as production-class ConfigVariables.
  What this ADR adds is the rationale (branching) and the environment axis.
- **The remaining work is the Branch dimension.** Today the target lowers only the
  production Branch (config is hard-coded `class: production`; no preview Branch is
  created). Making a Stage a Branch means: creating or targeting a Branch per
  environment (the production Branch for prod, a preview Branch per git branch),
  lowering per-branch resources and preview-class configuration, and keying deploy
  state per `(Project, Branch)`. The Alchemy primitives are already shaped for it —
  `EnvironmentVariable` models a preview-branch override, and `Deployment` relies on
  the platform materializing a branch's ConfigVariables into the version.
- **Deploy state re-keys to `(Project, Branch)`.** The hosted-state design
  ([ADR-0009](ADR-0009-deploy-state-is-hosted-in-the-workspace.md)) and any
  platform-side state API should key on `(Project, Branch)` rather than inventing a
  `(stack, stage)` namespace — the Branch already is the stage.
- **The state store stops being special.** ADR-0009 gave deploy state a dedicated,
  framework-bootstrapped `prisma-app-state` project — with find-or-create, an
  ownership marker, oldest-first adoption, and per-run connection minting — only
  because there was no stable, app-level container to attach state to (the app's own
  project was circular; there is no workspace-level database). One-Project-per-app
  supplies that container: the Project is a durable platform object that *outlives the
  per-Branch deploys that write state about it*, so no deploy ever destroys the store
  it writes to, and the circularity is gone. State is then provisioned and torn down
  with the Project like any other resource, addressed by `(Project, Branch)` — the
  bespoke bootstrap logic evaporates and the state layer becomes an ordinary
  target-supplied resource ([ADR-0011](ADR-0011-targets-supply-the-deploy-state-layer.md)),
  the same shape as postgres or compute. State must be anchored at the Project level,
  which outlives Branches; provisioning it as a per-Branch resource a Branch deploy
  then records in itself would re-introduce the circularity one level down.
- **Data is per-branch.** Each Branch owns its Databases, so the aggregate-contract
  and migration story runs per branch; a preview Branch's Postgres must be brought to
  the same contract before its services start.
- **PR previews of the whole topology** become a platform-native operation.
- **Branch lifecycle lives outside Alchemy — accepted.** Alchemy diffs and provisions
  the resources *within* a `(Project, Branch)`; it cannot create or destroy the Branch
  itself, because the Branch is the container its state is scoped to (the same
  circularity as the state store). Creating and tearing down Branches — the production
  Branch on first deploy, a preview Branch per git branch — is therefore a
  deploy-CLI/platform concern that runs before and around Alchemy, not an Alchemy
  resource. We accept that Alchemy does not orchestrate Branches.

## Alternatives considered

- **One Project per System.** Each System is its own Project with its own default
  Branch. Rejected: no Project represents the whole app, so branching — the mechanism
  behind PR previews and per-branch configuration — fragments across N projects and
  must be hand-coordinated by the framework, and the platform never sees the app as a
  single branchable unit. The per-System isolation it offers is expressed just as well
  by sibling Apps and Databases under one Project.

## Open questions

- **Who creates a Branch** — the deploy CLI (create-if-absent when `prisma-app deploy`
  targets a stage) or the platform on git events.
- **Stage name ↔ `Branch.gitName`** — how a stage identifier maps to a git branch
  name, and what a non-git `prisma-app deploy --name foo` creates.
- **Preview-branch data** — how a fresh preview Branch's Postgres reaches the
  contract: migrate-on-create versus copy-from-production.
- **Production-config constraint** — the platform bars branch-scoped overrides for
  production-class config; confirm the framework's per-branch wires (each branch's App
  has its own endpoint) are modeled as preview-class branch configuration.

## Related

- [ADR-0009](ADR-0009-deploy-state-is-hosted-in-the-workspace.md) — hosted deploy
  state, which this re-keys to `(Project, Branch)`.
- [ADR-0003](ADR-0003-deploy-derives-everything-from-the-root-node.md) — deploy
  derives everything from the root node (the App that becomes the Project).
- `docs/design/03-domain-model/glossary.md` — Stage → Environment, which is a Branch.
- The Prisma Cloud control-plane data model (Workspace → Project → Branch → App /
  Database) — the hierarchy this maps onto.
