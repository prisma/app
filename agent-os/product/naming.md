# Product Naming & Distribution

How the product and its pieces are named, and how developers get and compose them.
Some renames below are still proposed (noted inline); the building block and
registry names are settled.

## The names

| Name | Kind | What it is |
|---|---|---|
| **App** | hero noun | The single application a developer builds. What they care about. Kept plain and front — never renamed. |
| **Hex** | unit | The building block. A bounded context with typed inputs/outputs, published as an ordinary TypeScript library on npm. |
| **Hexicon** | registry | The directory where Hexes are discovered, ranked, and installed — `hexicon.dev`. A Prisma first-party property. |
| **Prisma Compose** | tool | Composes Hexes into an app (agent-driven). Rename of MakerKit — *proposed*. |
| **Prisma Model** | tool | The single-database data/contract layer. Rename of Prisma Next — *proposed*. |
| **Topology** | internal | The wired graph a Compose produces. Machinery, not user-facing vocabulary. |

## Naming principle

The developer's goal is an **app**, so "app" is the hero noun — it never needs
teaching. "Topology" and "composition" are the true internal objects but nobody
sets out to produce one; they stay machinery. "Product" would err the other way,
naming the business offering a layer above what the tool builds. So the pieces are
named for their **role in building one app**, which lets the family read as a
parts-list rather than a set of standalone mascots — the aggregate (a whole app
built from Prisma components) matters more than any single clever part.

## The building block: Hex

A Hex is a bounded context that exposes typed inputs and outputs and behaves like a
service (see `docs/design/03-domain-model/glossary.md`). That typed contract is the
point: a stranger's auth Hex drops into your app with a boundary the machine can
check — which is what makes composition safe when the composer is an **agent**
rather than a human reading source. Giving the shared unit its own short noun
follows the tradition of a gem, a crate, a package.

## The registry: Hexicon

"Hex" + "lexicon" — the catalog of Hexes. In a compose-from-blocks product the
registry is the highest-leverage name in the system: it becomes the verb developers
type and the destination they return to, it is the network-effect asset (a Hex is
published *to* somewhere and is *on* somewhere — that preposition needs a proper
noun), it is the trust mark for stranger-published Hexes, and — when the composer is
an agent — it is the agent's app store.

The name also sidesteps two collisions that bare "Hex" would hit: `hex.pm`, the
Elixir/Erlang package manager (a same-category registry, the most confusing kind of
clash), and `hex.tech`, an established data-tools brand.

## Distribution model

Hosting and discovery are split:

- **Hosting → npm.** Hexes are normal TypeScript libraries. npm brings semver,
  resolution, and tooling for free; the substrate stays boring and commodity.
- **Discovery → Hexicon.** A thin, named directory on top: search, ranking, trust,
  and a one-command install.

This follows the shape proven by skills.sh — decentralized hosting plus a named
central directory plus one-command install — with one deliberate difference:
**Hexicon's install composes, it doesn't just copy.** skills.sh drops text files
into an agent's config; Hexicon wires a Hex's typed contract into the app's
topology. That richer install is the point, and it depends on the typed-contract
model being sound.

Because community Hexes are arbitrary npm packages, Hexicon needs an indexing
convention (a `keywords` entry or a manifest field) to recognize a package as a Hex.

## The Prisma product family

A developer builds their app by composing Prisma components, each named for its
role. Read down the roles and it enumerates how you build an app:

| Component | Role |
|---|---|
| Prisma Postgres | persist |
| Prisma Compute | execute |
| Prisma Model *(← Prisma Next)* | data |
| Prisma Compose *(← MakerKit)* | system / topology |
| Durable Streams | stream |
| Connection | connect |

## Names to avoid

- **Bare "Hex" as the registry** — collides with `hex.pm` and `hex.tech`. Keep
  "Hex" for the *unit*; the registry has its own name (as gem→RubyGems,
  crate→crates.io, package→npm).
- **"Hexal" as a public, domain-fronted brand** — its domains are camped or guarded
  by Hexal AG (a pharmaceutical company; owns `hexal.com`). The `@hexal` npm org is
  registered but not the plan.
