# Product Naming & Distribution

We name every piece for the **value the user gets from it**, not the machinery that
delivers it. A developer builds an **app** by snapping together **Hexes** — reusable
blocks they find and install from **Hexicon**, wired together with **Prisma
Compose** — while their data lives in **Prisma Data**. This document explains that
rule, why each name follows from it, and how Hexes are distributed.

Some names are settled (Hex, Hexicon); the Prisma renames — Prisma Data (← Prisma
Next) and Prisma Compose (← MakerKit) — are still proposed.

## The pieces

| Name | What it is | The value it names |
|---|---|---|
| **App** | the application you build | software with users and features — the whole point |
| **Hex** | a building block | a capability you reuse instead of writing |
| **Hexicon** | the registry at `hexicon.dev` | finding and trusting those blocks |
| **Prisma Compose** | the tool that wires Hexes together | your app comes together, without hand-wiring infra |
| **Prisma Data** | the data layer | modeling, accessing, and managing *your data* |

Beneath each of these sits a precise internal term the user never has to say — the
**Topology** (the graph Compose produces), the **Contract** (what your data models
compile to). Those stay machinery; the brand takes the value word. The rest of this
doc explains why.

## Name for value, not machinery

Every layer has two nouns: the one the user is invested in and says out loud, and
the exact term for how it works underneath. Users say "my app" and "my data"; they
would never say "my topology" or "my contract." So the brand takes the first, and
the second stays below — kept precise, but unnamed in the marketing.

Four questions decide a name:

1. **Would the user put "my" in front of it?** "My data," yes. "My contract," no —
   that one is ours, not theirs.
2. **Does it predict the tooling?** "Data" tells you to expect model, migrate,
   query, types. A clever coinage tells you nothing.
3. **Does it name the goal, not the tax?** People value data *access*; migration is
   a necessary step, sometimes an obstacle, never the goal. Name the reward, not the
   chore.
4. **Does it keep the family legible?** Components named for their role read as the
   parts-list of one app — worth more than any single clever standalone name.

Taking the value word for the brand has a payoff: the precise words stay **free to
mean exactly what they mean one level down**. The same shape repeats at every layer —
the user names the left column, writes the middle, and the system consumes the
right:

| Product (what the user values) | Authored as | Compiles to |
|---|---|---|
| **App** | **Hexes** you snap together | a **Topology** |
| **Prisma Data** | **models** in PSL | a **Contract** |

Name the product itself "Model" or "Contract" and you steal a word that is more
useful below it.

## The building block: Hex

A Hex is a bounded context with typed inputs and outputs that behaves like a service
(see `docs/design/03-domain-model/glossary.md`). The typed boundary is what makes it
reusable: a stranger's auth Hex drops into your app with a contract the machine can
check — which is what lets an **agent**, not just a human, compose it in safely.
Giving the shared unit its own short noun follows the tradition of a gem, a crate, a
package.

## The registry: Hexicon

"Hex" + "lexicon" — the catalog of Hexes. In a compose-from-blocks product the
registry is the highest-leverage name in the whole system: it becomes the verb
developers type, the destination they return to, the network-effect asset (a Hex is
published *to* somewhere and is *on* somewhere — that preposition needs a proper
noun), the trust mark for stranger-published Hexes, and — when the composer is an
agent — the agent's app store.

The name also dodges two collisions that bare "Hex" would hit: `hex.pm`, the
Elixir/Erlang package manager (a same-category registry — the most confusing kind of
clash), and `hex.tech`, an established data-tools brand.

## The data layer: Prisma Data

The value here is *your data* — and above all accessing and querying it. That is why
the layer is named **Data**, not "Model" or "Contract." Modeling and migration are
the way in, not the goal, and you don't brand a product after the tax it charges.
Naming it "Data" also keeps the two precise words at work: you still author
**models** in PSL — the part of Prisma developers love, untouched — and those models
compile to a **Contract**, the typed boundary a Hex's input requires and a Postgres
output satisfies. Data is the value; model is what you write; Contract is what the
system wires against.

## How Hexes are distributed

Hosting and discovery are split:

- **Hosting → npm.** Hexes are ordinary TypeScript libraries. npm brings semver,
  resolution, and tooling for free; the substrate stays boring and commodity.
- **Discovery → Hexicon.** A thin, named directory on top: search, ranking, trust,
  and a one-command install.

This is the shape skills.sh proved — decentralized hosting, a named central
directory, one-command install — with one deliberate difference: **Hexicon's install
composes, it doesn't just copy.** skills.sh drops text files into an agent's config;
Hexicon wires a Hex's typed contract into the app's topology. That richer install is
the point, and it depends on the typed-contract model being sound.

Because community Hexes are arbitrary npm packages, Hexicon recognizes them by
convention — a `keywords` entry or a manifest field.

## The Prisma primitives you compose from

Prisma Compose and Prisma Data are two members of a larger set: the Prisma
primitives a developer assembles into an app. Each is named for its role, and read
down the value column it says what building an app is *for*:

| Primitive | Role | The value to the user |
|---|---|---|
| Prisma Postgres | persist | my data has a home |
| Prisma Compute | execute | my code runs |
| Prisma Data *(← Prisma Next)* | data | I model, access, and manage my data |
| Prisma Compose *(← MakerKit)* | compose | my app comes together from parts |
| Durable Streams | stream | my events flow and survive |
| Connection | connect | my services reach each other |

A product name need not equal its role word — Compute's role is "execute." So
"Prisma Data" naming the data layer is consistent with the family even though its
role is data modeling.

## Names to avoid

- **Bare "Hex" for the registry** — collides with `hex.pm` and `hex.tech`. Keep
  "Hex" for the *unit*; the registry gets its own name (gem→RubyGems,
  crate→crates.io, package→npm).
- **"Hexal" as a public, domain-fronted brand** — its domains are camped or guarded
  by Hexal AG (a pharmaceutical company that owns `hexal.com`). The `@hexal` npm org
  is registered but is not the plan.
- **"Model" or "Contract" for the data layer** — each steals a word more useful one
  level down (`model` is the PSL construct; a `Contract` is what models compile to),
  and neither names the user's actual value: data access.
