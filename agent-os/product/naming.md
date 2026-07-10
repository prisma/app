# Product Naming & Distribution

A developer builds an **app** by composing Prisma primitives — Postgres, Compute,
Data, and more — wired together by the **Prisma App Framework**. We name every piece
for the **value the user gets from it**, not the machinery that delivers it. This
document covers the product family, how Prisma App fits into it, the vocabulary it
introduces, and how its building blocks (Systems) are distributed.

The framework name and its unit are settled: **Prisma App** (← MakerKit) and
**System** (← Hex), recorded in
[ADR-0014](../../docs/design/90-decisions/ADR-0014-name-the-framework-prisma-app-and-its-unit-system.md).
**Prisma Data** (← Prisma Next) is still proposed. The **registry** name is
deferred until the registry itself is built.

## The Prisma product family

Each primitive is named for its role. Read down the value column and it says what
building an app is actually *for*:

| Primitive | Role | The value to the user |
|---|---|---|
| Prisma Postgres | persist | my data has a home |
| Prisma Compute | execute | my code runs |
| Prisma Data *(← Prisma Next)* | data | I model, access, and manage my data |
| Prisma App *(← MakerKit)* | compose | my app comes together from parts |
| Durable Streams | stream | my events flow and survive |
| Connection | connect | my services reach each other |

A product name need not equal its role word — Compute's role is "execute," Prisma
App's is "compose the rest." The name takes whichever word carries the most user
value, and for the framework that assembles an app, the value word *is* the app.

## How Prisma App fits

The other primitives each deliver one capability. **Prisma App is different: it is
the framework that assembles the others into a running app.** It is the composition
layer of the family — and it introduces its own small vocabulary for the job:

| Term | What it is | The value it names |
|---|---|---|
| **App** | the application you build (the outermost System) | software with users and features — the whole point |
| **System** | a building block you compose | a capability you reuse instead of writing |
| **Topology** | the graph the framework produces | *(machinery — the user never says this)* |

You build an **App** by snapping together **Systems** — each one wrapping primitives
like Compute and Postgres; the framework infers the **Topology** and provisions it.
App and System are the words a developer says; Topology is the machinery underneath.
The App is not a separate construct — it is simply the outermost System, the one you
point `prisma-app deploy` at.

## Name for value, not machinery

That split — the word the user says versus the term for how it works — is the rule
behind every name here. Users say "my app" and "my data"; nobody says "my topology."
So the brand takes the first, and the precise term stays below, kept exact but
unnamed in the marketing.

Four questions decide a name:

1. **Would the user put "my" in front of it?** "My app," "my data" — yes. "My
   topology" — no; that's the wiring the tool produces, not the thing you set out to
   build.
2. **Does it predict the tooling?** "Data" tells you to expect model, migrate,
   query, types. A clever coinage tells you nothing.
3. **Does it name the goal, not the tax?** People value data *access*; migration is
   a necessary step, sometimes an obstacle, never the goal. Name the reward, not the
   chore.
4. **Does it keep the family legible?** Components named for their role read as the
   parts-list of one app — worth more than any single clever standalone name.

The payoff of taking the value word for the brand: the precise words stay **free to
mean exactly what they mean one level down**. The same shape repeats at every layer —
the user names the left column, writes the middle, and the system consumes the
right:

| Product (what the user values) | Authored as | Compiles to |
|---|---|---|
| **App** | **Systems** you snap together | a **Topology** |
| **Prisma Data** | **models** in PSL | a **Contract** |

Note that "App" sits in the *Product* column, not the *Authored as* column — you do
not write an `app()`; you write `system()`, and the App is the outermost one. Naming
the framework "App" takes the value word without stealing an authoring word.

## The data layer: Prisma Data

The value here is *your data* — and above all accessing and querying it. That is why
the layer is named **Data**, not "Model" or "Contract." Modeling and migration are
the way in, not the goal, and you don't brand a product after the tax it charges.
Naming it "Data" also keeps the two precise words at work: you still author
**models** in PSL — the part of Prisma developers love, untouched — and those models
compile to a **Contract**, the typed boundary a System's input requires and a
Postgres output satisfies. Data is the value; model is what you write; Contract is
what the system wires against.

## The building block: System

A System is a bounded context with typed inputs and outputs that behaves like a
service (see `docs/design/03-domain-model/glossary.md`). The typed boundary is what
makes it reusable: a stranger's auth System drops into your app with a contract the
machine can check — which is what lets an **agent**, not just a human, compose it in
safely. Giving the shared unit its own short noun follows the tradition of a gem, a
crate, a package.

"System" won over the earlier working name "Hex" because its naive reading is
already correct — a developer says "the auth system" unprompted, where "Hex" first
reads as a color, hexadecimal, or a curse. The full reasoning, and the alternatives
weighed, are in
[ADR-0014](../../docs/design/90-decisions/ADR-0014-name-the-framework-prisma-app-and-its-unit-system.md).

## How Systems are distributed

Hosting and discovery are split:

- **Hosting → npm.** Systems are ordinary TypeScript libraries. npm brings semver,
  resolution, and tooling for free; the substrate stays boring and commodity.
- **Discovery → a registry.** A thin, named directory on top: search, ranking,
  trust, and a one-command install. **Its name is deferred** — the earlier working
  name "Hexicon" derived from "Hex" and no longer fits; a replacement is a separate
  decision, taken when the registry is built.

This is the shape skills.sh proved — decentralized hosting, a named central
directory, one-command install — with one deliberate difference: **the registry's
install composes, it doesn't just copy.** skills.sh drops text files into an agent's
config; here the install wires a System's typed contract into the app's topology.
That richer install is the point, and it depends on the typed-contract model being
sound. Because community Systems are arbitrary npm packages, the registry recognizes
them by convention — a `keywords` entry or a manifest field.

## Names to avoid

- **"Model" or "Contract" for the data layer** — each steals a word more useful one
  level down (`model` is the PSL construct; a `Contract` is what models compile to),
  and neither names the user's actual value: data access.
- **A registry name derived from the unit noun** — the registry deserves its own
  proper noun (gem→RubyGems, crate→crates.io), not "System registry." Deferred, not
  decided.
