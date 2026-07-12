# ADR-0014: Name the framework "Prisma App", the CLI `prisma-app`, and expose one authoring primitive

## Status

Accepted. The unit-of-composition noun this ADR originally chose was later
superseded by [ADR-0025](ADR-0025-name-the-unit-of-composition-module.md): the unit
is a **Module**, authored with `module()`. The decisions below — the framework name,
the `@prisma/app*` package family, the `prisma-app` CLI, and the single-primitive
model with no separate `app()` — all stand.

## Decision

The framework is the **Prisma App Framework**, published as `@prisma/app` (target
packs as `@prisma/app-nextjs`, `@prisma/app-cloud`, `@prisma/app-node`,
`@prisma/app-rpc`, `@prisma/app-assemble`, `@prisma/app-cli`; the Alchemy provider
package as `@prisma/alchemy`). The CLI binary — previously `makerkit` — is
**`prisma-app`**.

There is exactly one authoring primitive, `module()`, and no separate `app()`
construct: **the App is the outermost Module**, distinguished only by being the node
you deploy. This ADR fixes that there is a *single* primitive; the unit's noun and
its constructor are settled in
[ADR-0025](ADR-0025-name-the-unit-of-composition-module.md).

This replaces the working names "MakerKit" (the framework) and "Hex" (the unit).

## Reasoning

Start from what a developer is trying to do: build an app, deploy it, and see it
run. Everything the framework offers serves that outcome, so the name should be that
outcome. "MakerKit" sounds like a standalone starter kit that happens to share a
logo with the rest of the family; it says nothing about building an app and sits
outside the Prisma family it belongs to. The name should instead be the value the
user is after — their app — which is why the framework is **Prisma App**, the
component of the family whose job is to assemble the others into a running
application.

We name every part for the value it delivers, not the machinery that delivers it.
That rule lives in the product naming doc as a three-column shape: the **Product** is
what the user values, the middle column is what they **author**, and the right column
is what it **compiles to**. For this framework the row reads: you value an **App**,
you author it as **Modules**, and it compiles to a **Topology**. "App" belongs in the
Product column — it is the outcome, not a thing you write — so a code constructor
named `app()` would be a category error, dragging the value word onto the authoring
surface. The thing you *do* write is one primitive.

So we expose exactly one. A `module()` wraps services, resources, and other modules,
and composes recursively. The App is simply the outermost one. Nothing in the source
marks a module as "the root"; the root is whichever node you point `prisma-app
deploy` at. This falls out of a capability we already have and want — deploying a
single module in isolation, for testing, is the same operation as deploying the whole
app, just aimed at a different node. Keeping a single primitive also honors two
standing principles: **compose, don't special-case** (no privileged root type) and
**thin core** (one authoring construct, not two). The choice of the unit's *noun* is
a separate question, settled in
[ADR-0025](ADR-0025-name-the-unit-of-composition-module.md).

A consequence worth stating plainly: "App" never appears as an imported symbol. It is
the product name, the package (`@prisma/app`), and the word for the deployed result —
"my app is live" — but developers only ever type `module()`. That keeps the authoring
surface honest to the three-column model, and it shrinks a naming collision: "a
Prisma app" today colloquially means "an app that uses the Prisma ORM," and since
nobody writes an `App` type in code, the two meanings never meet on the page.

The CLI binary is `prisma-app`, not `prisma`. Bare `prisma` belongs to the Prisma
ORM CLI; the app framework cannot claim it. `prisma-app deploy` is unambiguous today
and leaves room for the command to later become a subcommand of a unified `prisma`
CLI — a separate project — without stranding users on a name we had to walk back.

## Consequences

- **One authoring primitive.** The whole model is: define a module, compose modules,
  deploy the outer one. Fewer concepts to learn; the root needs no special syntax.
- **"App" is outcome-only vocabulary.** It names the product and the running result,
  never a construct. Do **not** add a `defineApp()` sugar preemptively — sugar can be
  added later, a primitive cannot be removed once it is in the wild.
- **The CLI is `prisma-app`.** Its generated scratch directory is `.prisma-app/`
  (not `.prisma/`, which the ORM owns). If it later folds into a `prisma` subcommand,
  that is a deliberate future migration, not this decision.
- **A repo-wide rename.** `@makerkit/*` becomes `@prisma/app*` (with
  `@makerkit/prisma-alchemy` becoming the independent `@prisma/alchemy`), the
  `makerkit` binary becomes `prisma-app`, and design docs, the glossary, the README,
  and earlier ADRs move from "Hex"/"MakerKit" to "Module"/"Prisma App" — including
  [ADR-0005](ADR-0005-users-build-the-framework-assembles.md), whose title and body
  name the framework directly.

## Alternatives considered

- **Prisma Compose (for the framework).** Elegant — it describes exactly what the
  tool does — but it names the mechanism, not the user's goal, and "compose" is a
  verb, not a noun that sits beside Postgres and Compute in the family. Decisively,
  its search space is already owned: results for "prisma compose" are dominated by
  docker-compose-with-Prisma content, including our own Docker docs.
- **Overlay (for the framework or the topology).** A precise description of what the
  topology *is* — a logical graph lowered onto real infrastructure — and a good
  internal word for that concept. But as a product name it is too abstract: readers
  steeped in the domain still needed it explained, so it fails the first-encounter
  test that the whole naming philosophy is built to pass.
- **The unit's noun** — the candidates weighed for what you author (Hex, and later
  System, Component, and branded nouns) — is settled separately in
  [ADR-0025](ADR-0025-name-the-unit-of-composition-module.md), which lands on
  **Module**.

## Related

- `agent-os/product/naming.md` — name-for-value principle and the three-column model.
- `agent-os/product/naming-proposal.md` — the family-of-components framing this fits into.
- `docs/design/03-domain-model/glossary.md` — the ubiquitous language this renames.
- [ADR-0025](ADR-0025-name-the-unit-of-composition-module.md) — names the unit of composition **Module**, authored with `module()`.
- [ADR-0003](ADR-0003-deploy-derives-everything-from-the-root-node.md) — deploy derives everything from the root node (the "outermost Module is the deploy target" mechanism).
- [ADR-0006](ADR-0006-every-node-is-named.md) — the root's name names the application.
- `docs/design/01-principles/guiding-principles.md` — "compose, don't special-case" and "thin core".
