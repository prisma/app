# Prisma Composer

**Prisma Composer** deploys multi-service TypeScript apps to Prisma Cloud
from a description you write in TypeScript. You declare each service and what
it depends on — other services, databases, schedules, secrets — compose them
into a **Prisma App**, and `prisma-composer deploy` provisions all of it:
Compute services, Prisma Postgres databases, the wiring between them. There
is no infrastructure configuration to write or maintain.

It earns its keep when an app is more than one piece. A lone server is easy
to deploy anywhere; the work starts when the storefront needs the catalog's
URL, the catalog needs its database's connection string, the cron job needs
credentials, and every one of those has to be repeated per environment.
Composer makes each of those edges a typed declaration and derives the rest.

Two rules shape everything:

- **Your code never reaches for its environment.** No `process.env`, no URLs.
  Every dependency arrives typed, through one call — which is also why any
  environment (production, a staging copy, a test) is just different injected
  values.
- **The framework never bundles or transforms your code.** You build; the
  deploy assembles what you built.

## What it looks like

A service declares its dependencies; app code receives them from
`service.load()`:

```ts
// service.ts — the declaration: pure data
export default compute({
  name: 'storefront',
  deps: { catalog: rpc(catalogContract) },   // "I call catalog's API"
  build: nextjs({ module: import.meta.url, appDir: '..' }),
});

// app code — load() returns a client typed by that contract
const { catalog } = service.load();
const { products } = await catalog.listProducts({});
```

The root module is the app — provision the pieces, wire the typed ports:

```ts
export default module('store', ({ provision }) => {
  const catalog = provision(catalogModule);                       // owns its own Postgres
  const orders = provision(ordersModule, { deps: { catalog: catalog.rpc } });
  provision(storefrontService, { deps: { catalog: catalog.rpc, orders: orders.rpc } });
});
```

That's [`examples/store`](examples/store/) — four components and their edges,
deployed with one command:

```mermaid
flowchart TB
  User((User))

  subgraph Storefront["storefront"]
    SF["Next.js"]
  end
  subgraph Catalog["Module: catalog"]
    CA["catalog API"]
    CPG[("Postgres · typed by contract.prisma")]
    CA --- CPG
  end
  subgraph Orders["Module: orders"]
    OR["orders API"]
    OPG[("Postgres · typed by contract.prisma")]
    OR --- OPG
  end
  subgraph Cron["cron (shared module)"]
    CR["scheduler + promotions runner"]
  end

  User -->|HTTP| SF
  SF -->|rpc · catalogContract| CA
  SF -->|rpc · ordersContract| OR
  OR -->|rpc · catalogContract| CA
  CR -->|rpc · catalogContract| CA
```

Each box is a **Module**: a boundary that owns some code and data and is
reachable only through typed ports. catalog and orders each own their own
Postgres — a [Prisma Next](https://github.com/prisma/prisma-next)-typed one,
with migrations applied at deploy — and the root never sees them; the only
edges are the exposed, contract-typed RPC ports. Because nothing reaches
inside a boundary, every dependency in the app is an explicit,
compiler-checked edge.

## Getting started

```sh
pnpm add @prisma/composer @prisma/composer-prisma-cloud arktype
```

Start with **[Getting started](docs/guides/getting-started.md)** — an empty
directory to a deployed two-service app, plus how to port an app you already
have.

| Guide | Covers |
| --- | --- |
| [Getting started](docs/guides/getting-started.md) | Your first app end to end; porting an existing Node or Next.js app |
| [Building an app](docs/guides/building-an-app.md) | Contracts, databases (plain + Prisma Next-typed with migrations), reusable Modules, cron/storage/streams, config, secrets |
| [Testing](docs/guides/testing.md) | Unit tests with `mockService`, integration tests with `bootstrapService` |
| [Deploying and operating](docs/guides/deploying.md) | Stages, destroy, CI, how apps behave in production |

## Examples

Complete, deployable apps under [`examples/`](examples/):

| Example | Demonstrates |
| --- | --- |
| [pn-widgets](examples/pn-widgets/) | The minimal app: one service + one Prisma Next-typed Postgres |
| [storefront-auth](examples/storefront-auth/) | Next.js frontend + API service, a reusable Module owning its database, secrets |
| [store](examples/store/) | Four modules, typed databases with migrations, the shared cron module |
| [cron](examples/cron/) | Scheduled jobs: `defineSchedule` + `serveSchedule` + the cron module |
| [storage](examples/storage/) | The S3-backed blob store module |
| [streams](examples/streams/) | Durable append-only event streams over storage |

## For agents

A condensed version of the guides ships as an installable agent skill:

```sh
npx skills add prisma/composer --skill prisma-composer
```

See [`skills/`](skills/).

## Design & internals

For contributors — the design record, not required reading for building apps:

- **Purpose and principles** — [`docs/design/00-purpose/`](docs/design/00-purpose/),
  [`docs/design/01-principles/`](docs/design/01-principles/)
- **Domain deep dives** — [`docs/design/10-domains/`](docs/design/10-domains/)
  (core model, contracts, module composition, config, deploy CLI, testing)
- **Decisions** — [`docs/design/90-decisions/`](docs/design/90-decisions/) (the ADR index)
- **Reading order** — [`docs/design/README.md`](docs/design/README.md)
- **Platform footguns** — [`gotchas.md`](gotchas.md)
