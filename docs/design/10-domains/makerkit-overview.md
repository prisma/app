# MakerKit overview

This document is the initial, broad design capture from early discussions. Over time, content here should be factored into:

- `docs/design/01-principles/` (principles)
- `docs/design/10-domains/` (domain deep dives)
- `docs/design/90-decisions/` (ADRs)

---

# MakerKit Broad Design (Convex-, Wrangler-, and Prisma Next-inspired)

## Context

MakerKit is a **TypeScript framework** for defining applications deployed on the Prisma Platform (Prisma Postgres today; Prisma Compute, File Storage, and Durable Streams to follow).

MakerKit has two primary responsibilities:

1. **Static topology inference**: From TypeScript source structure, build a graph of platform components (services + dependencies) that can drive provisioning (IaC) and wiring.
2. **Runtime execution + dependency injection (DI)**: Provide execution entrypoints for user code (HTTP, workers, subscribers, cron jobs, etc.) and inject environment-specific implementations (local/test/prod).

This design is **heavily inspired by Convex**, which exposes a small set of primitives (functions + database + scheduling + file storage + components) and uses that structure to hook app code to the underlying platform services (see: [Convex Database](https://docs.convex.dev/database), [Actions](https://docs.convex.dev/functions/actions), [HTTP Actions](https://docs.convex.dev/functions/http-actions), [Scheduling](https://docs.convex.dev/scheduling), [File Storage](https://docs.convex.dev/file-storage), [Components](https://docs.convex.dev/components)).

It is also heavily inspired by **Cloudflare Wrangler**, which provides a cohesive developer experience for **build/dev/deploy** and resource wiring, but typically uses a separate manifest/config (commonly `wrangler.toml`, and increasingly `wrangler.jsonc`) as the source of truth for application configuration and bindings (see: [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/), [Wrangler overview](https://developers.cloudflare.com/workers/wrangler/)).

## Inspiration: Convex mental model (what we’re borrowing)

Convex’s docs present an application as a set of platform-capability “surfaces” that your code plugs into:

- **Functions**
  - **Actions**: defined with an `action({ args, handler })` constructor; can call external services, and interact with the DB indirectly via `runQuery`/`runMutation`. They receive an action context that also exposes `auth`, `storage`, and `scheduler` ([Actions](https://docs.convex.dev/functions/actions)).
  - **HTTP Actions**: define HTTP endpoints via a router, using Fetch `Request`/`Response` and a handler constructor `httpAction(...)` ([HTTP Actions](https://docs.convex.dev/functions/http-actions)).
- **Database**: a document-oriented store with an optional schema; tables spring into existence on insert; queries and mutations read/write via a JS API ([Database](https://docs.convex.dev/database)).
- **Scheduling**: schedule functions once (“scheduled functions”) or repeatedly (“cron jobs”) ([Scheduling](https://docs.convex.dev/scheduling)).
- **File storage**: upload/store/serve/delete files; integrate through server functions and/or HTTP actions ([File Storage](https://docs.convex.dev/file-storage)).
- **Components**: packaged, sandboxed units that include code + data; components can’t reach into the host app unless explicitly wired, and they can have their own isolated DB tables and function env ([Components](https://docs.convex.dev/components)).

## Inspiration: Wrangler mental model (what we’re borrowing)

Wrangler is a great reference point for the *operational* side of the developer experience:

- A single tool that supports **local dev**, **build/bundle**, and **deploy**
- A configuration-driven model for:
  - **Entrypoints** (what runs)
  - **Bindings** (what resources the code can access)
  - **Environments** (dev/staging/prod differences)

Wrangler traditionally expresses this in a separate manifest (`wrangler.toml` / `wrangler.jsonc`) which is treated as the source of truth for configuration and bindings ([Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)).

### Key difference: MakerKit is code-first, not manifest-first

We want the **ergonomics and end-to-end flow** of Wrangler, but without requiring developers (or agents) to maintain a parallel declarative config file that can drift from the application’s actual structure.

- **Wrangler**: “declare IaC-ish intent in a manifest, then point to code”
- **MakerKit**: “declare resources + executables in TypeScript, then *compile* a manifest from code”

Concretely:

- MakerKit should still emit a stable “deployment manifest” artifact (e.g. `makerkit.map.json`) that plays a similar role to `wrangler.toml` for the platform control plane, but it should be **generated** from TypeScript descriptors rather than manually authored.
- Environment-specific configuration should be expressed as **typed, explicit code** (or typed configuration loaded by code) so agents can safely refactor and validate it.

## Inspiration: Prisma Next mechanics (what we’re borrowing)

Prisma Next is a useful internal reference because it’s also designed for **agentic workflows** and is built around
**structured, verifiable artifacts** rather than opaque generated runtime code.

Key learnings to apply to MakerKit:

- **Contract-first artifacts**: Prefer stable JSON artifacts + lightweight TypeScript types as the primary integration surface (machine-readable, diffable, inspectable).
- **Determinism + verification**: Use hashes/IDs to tie artifacts to exact source inputs so the platform (and agents) can detect drift and verify compatibility.
- **Composable DSL over magic codegen**: Provide a small, explicit, statically analyzable API surface that agents can synthesize and refactor reliably.
- **Clear layering and boundaries**: Keep a modular package architecture and enforce boundaries to avoid “everything imports everything” over time (helps both humans and agents).

How this maps onto MakerKit:

- The “contract artifact” becomes the **application topology map** (`makerkit.map.json`) plus any typed contracts referenced by that map (stream payload schemas, service interfaces, etc.).
- The “verification model” becomes **graph hashing** and compatibility checks (e.g., a hash of the descriptor graph and per-node hashes for executable/resource descriptors).
- The “DSL surface” is the set of `define*` primitives + composition APIs that produce descriptors without hidden side effects, enabling static analysis.

## MakerKit: proposed programming model

MakerKit aims to generalize the same code-first approach to **all Prisma Platform primitives** (database, compute, storage, streams) and to elevate “functions” into a more explicit graph of **executable units** and **resources**.

### Core idea: “descriptors” define your app graph

User code defines **descriptors** (pure/serializable definitions) for:

- **Resources**: Postgres DBs, buckets, streams, secrets/config, etc.
- **Executables**: HTTP APIs, background workers, event subscribers, cron jobs, stream processors.
- **Composition units**: reusable Components (see below), with explicit “ports”.

Descriptors are intended to be:

- **Statically analyzable** (import graph + descriptor metadata).
- **Serializable** to a stable metadata form (e.g. `makerkit.map.json`) for provisioning.
- **Referenceable** via idiomatic TypeScript imports, so agents can scaffold and refactor predictably.

### Example (sketch)

```ts
// db.ts
import { definePostgres } from "@prisma/makerkit";

export const db = definePostgres({
  name: "main",
  // target: "prisma-postgres" (implicit default)
});

// streams.ts
import { defineStream } from "@prisma/makerkit";
export const userEvents = defineStream<{ type: string; userId: string }>({
  name: "userEvents",
});

// api.ts
import { defineHttpApi } from "@prisma/makerkit";
import { db } from "./db";
import { userEvents } from "./streams";

export const api = defineHttpApi({
  name: "api",
  deps: { db, userEvents },
}).route("POST", "/users", async (ctx, req) => {
  // ctx.db, ctx.userEvents, etc (injected)
  return new Response("ok");
});
```

Notes:
- The goal is not the exact API shape above, but the **properties**: descriptors are defined in modules, imported, and connected declaratively; handlers are entrypoints that receive DI.
- Like Convex HTTP Actions, handlers should be Fetch `Request`/`Response` flavored for portability ([HTTP Actions](https://docs.convex.dev/functions/http-actions)).

## Static topology inference (IaC from code)

MakerKit should be able to “compile” an app definition into a stable graph:

- **Nodes**: executables + resources (compute units, DBs, buckets, streams, schedules).
- **Edges**: dependencies (e.g., API → Postgres, Worker → Stream, Subscriber → Storage).
- **Contracts**: typed data contracts where relevant (stream payload types, DB schema contracts, etc).

Output artifacts (proposal):

- `makerkit.map.json`: the full dependency graph + metadata required for orchestration.
- `dist/**`: bundled code artifacts for each executable entrypoint (e.g., API, worker).

This graph is what a platform orchestration layer consumes to provision:

- Prisma Postgres instances
- Prisma Compute instances (Bun on VM)
- Storage buckets
- Durable Streams
- Wiring (service endpoints, credentials, env vars, routes)

## Two planes: control plane vs execution plane (Prisma Next-inspired)

Prisma Next has a useful split between **control plane** (CLI/admin-time) and **execution plane** (runtime), and MakerKit should adopt the same mechanics.

### Control plane (CLI / inspection / provisioning-time)

**Goal:** Operate on *descriptors* and *artifacts* to understand and administer the application *without running it as a live system*.

Responsibilities:

- **Load app definition (descriptors-only):** Import the user’s MakerKit descriptors and normalize defaults.
- **Validate shape + compatibility:** Ensure required dependencies are present, contracts are well-formed, and there’s no “hidden coupling” that will break DI later.
- **Build topology:** Produce the service/resource dependency graph (what runs, what it depends on, what needs provisioning).
- **Emit platform-facing metadata:** Generate `makerkit.map.json` (analogous in role to Wrangler’s manifest, but generated from TypeScript rather than authored by hand; see [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)).
- **Plan/apply orchestration actions (TBD):** Provide a control API surface that can drive platform provisioning and wiring (create/update DBs, compute units, buckets, streams; attach bindings; configure routes).
- **Local dev bootstrap (TBD):** Produce the runtime wiring for local emulation (ports, env, endpoints), and start local emulators where needed.

This is where you “ask questions about the app” and “produce handles”:

- What is the app’s topology?
- What entrypoints exist?
- What resources must exist, and what are their bindings?
- What artifacts should be uploaded to the platform, and how are they partitioned?

### Execution plane (runtime)

**Goal:** Instantiate real implementations and run the application’s entrypoints.

Responsibilities:

- **Instantiate a runtime stack:** Choose an environment provider (platform vs local vs test) and create concrete instances for resources (DB, storage, streams, scheduler) and executables.
- **Dependency injection + graph satisfaction:** Traverse the topology, resolve bindings, and inject the correct dependencies into each entrypoint handler.
- **Run entrypoints:** Start the HTTP surface(s), workers, subscribers, cron handlers, stream processors, etc.
- **Runtime observability + errors (TBD):** Provide structured logs/errors at runtime boundaries.

This is the “system is live” mode: request handling, stream processing, background work.

### Key packaging rule: prevent control/runtime drift

One of Prisma Next’s strongest learnings is to **separate control-plane entrypoints from runtime entrypoints** so that:

- Control plane code stays statically analyzable and does not pull in runtime-only concerns.
- Runtime code can evolve without accidentally requiring CLI-only dependencies.

MakerKit should mirror this by establishing explicit import surfaces, e.g.:

- `@prisma/makerkit/control` — descriptor types, normalization, validation, topology build, manifest emission
- `@prisma/makerkit/runtime` — runtime interfaces, providers, DI container, entrypoint executors

Packages that span both should expose separate entrypoints (e.g. `./control` vs `./runtime`) and keep dependencies directed to avoid accidental coupling.

## Runtime execution + DI

At runtime, MakerKit should:

- Provide **entrypoint conventions** (“here is the HTTP server entrypoint”, “here is the cron entrypoint”, etc.).
- Traverse the app graph and request concrete implementations from an **environment provider**:
  - **Platform provider**: uses real Prisma services (Compute/Postgres/Storage/Streams).
  - **Local provider**: uses local emulators or compatible substitutes.
  - **Test provider**: uses isolated resources and/or in-memory fakes.

This mirrors Convex’s use of a context object that grants access to platform features such as DB, storage, and scheduler ([Actions](https://docs.convex.dev/functions/actions)).

## Durable Streams (backbone)

Realtime and streaming communication is a core characteristic of the Prisma Platform and MakerKit. MakerKit’s default programming model should be **streaming-first**, with request/response built as an adapter on top when needed.

### Decision: log/topic first (A), build workflows/queues on top (B)

- **DurableStream is a log/topic primitive**: append-only event streams that services can publish to and subscribe from.
- **Queue/workflow semantics are layered**: work queues, retries, and durable workflows are built *on top* of DurableStream rather than being separate core primitives.

### Decision: consumer groups + checkpoints are first-class

The DurableStream runtime contract includes first-class **consumer groups** and **checkpoints** (progress tracking), so that:

- Multiple independent consumers can read the same stream safely.
- “Work queue” patterns can be expressed without re-implementing correctness in every app.

## Scheduling

Convex explicitly models both “run once later” and recurring cron ([Scheduling](https://docs.convex.dev/scheduling)).

MakerKit should support:

- **Cron jobs**: recurring schedules bound to a handler.
- **Scheduled functions**: one-off delayed execution (useful for durable workflows).

In the graph model, schedules are first-class nodes that target executable handlers (edges).

## File storage

Convex documents file storage operations (upload/store/serve/delete) and emphasizes integrating storage into server-side functions and HTTP actions ([File Storage](https://docs.convex.dev/file-storage); [HTTP Actions](https://docs.convex.dev/functions/http-actions)).

MakerKit should define:

- `defineBucket(...)` (or equivalent) as a resource descriptor.
- Runtime interfaces for storing/serving files:
  - Local dev can use filesystem-backed or MinIO-compatible providers.
  - Platform uses Prisma File Storage.

## Components (composition units)

Convex Components are sandboxed “mini backends” that are safe to install; they can’t access host app tables/functions unless explicitly passed, and they can include isolated DB tables and function environment ([Components](https://docs.convex.dev/components)).

MakerKit’s analogous concept (building on your brain dump):

- A **Component** is a package of descriptors (resources + executables).
- Its **ports** are the external dependencies it needs (inputs) and the exports it provides (outputs).
- Composition is explicit: the app links ports together (no ambient cross-component access).

This is also designed to be agent-friendly:

- Components have a stable structure, explicit ports, and predictable wiring points.
- Agents can scaffold Components and connect them without guesswork.

## Interface to the Prisma Platform

MakerKit needs a platform-facing contract for provisioning and execution. Minimum surface area:

- **Artifact structure**: how code is bundled and uploaded (per executable).
- **Metadata map**: the dependency graph + contracts (`makerkit.map.json`).
- **Wiring contract**: how provisioned resources are surfaced to execution (env vars, service bindings, secrets).

This is intentionally similar in spirit to Convex exposing a cohesive platform where functions integrate with database, scheduling, and storage through provided contexts and endpoints (see: [Actions](https://docs.convex.dev/functions/actions), [HTTP Actions](https://docs.convex.dev/functions/http-actions), [Scheduling](https://docs.convex.dev/scheduling), [File Storage](https://docs.convex.dev/file-storage)).

## Entrypoints: what the platform executes (execution contract)

We should model “entrypoints” as first-class, addressable units that the Prisma Platform can run on provisioned compute.

### Perspective: Prisma Platform runtime

Assume the platform has:

- Provisioned the required dependencies (e.g. a Prisma Postgres instance, an HTTP ingress attachment).
- Staged the user’s code artifact(s) onto a VM with Bun.
- Loaded the MakerKit metadata (topology/manifest).

Now it wants to run the app by delegating to MakerKit:

> “Execute entrypoint `X`, and here are the provisioned bindings for the dependencies that entrypoint requires.”

### Proposed minimal entrypoint model

An entrypoint is a tuple:

- **Entrypoint ID**: stable identifier chosen by MakerKit (e.g. `service.api#http`).
- **Kind**: the execution shape (e.g. `http-service`, `worker`, `subscriber`, `cron`).
- **Artifact reference**: how to load it (bundle key + module path + export name).
- **Declared dependency bindings**: the list of required resource bindings (e.g. `db.main`) and runtime/system bindings (e.g. `ingress.public`).

Example (conceptual) JSON in `makerkit.map.json`:

```json
{
  "entrypoints": [
    {
      "id": "service.api#http",
      "kind": "http-service",
      "artifact": { "bundle": "app", "module": "./dist/api.js", "export": "default" },
      "requires": {
        "resources": { "db": "resource.postgres.main" },
        "system": { "ingress": "ingress.http.public" }
      }
    }
  ]
}
```

### Execution API sketch

At runtime, the platform calls something like:

```ts
await makerkit.executeEntrypoint({
  entrypointId: "service.api#http",
  artifactRoot: "/app", // where bundles/modules are staged
  bindings: {
    resources: {
      "resource.postgres.main": postgresInstance,
    },
    system: {
      "ingress.http.public": ingressInstance,
    },
  },
});
```

Important: **user application code does not read globals** to find these things. The platform can source config from env vars internally, but the only interface MakerKit exposes to user code is injected dependencies (see `docs/design/01-principles/architectural-principles.md`).

### Where DI happens (Express model)

For an `http-service` entrypoint, the user’s artifact export should be something that is “runnable” once dependencies are injected. With the Express-first choice, the most direct contract is:

- User exports a factory that receives injected dependencies and returns an Express app instance.
- MakerKit (or a platform adapter) is responsible for binding that Express app to the provided ingress.

Conceptual shape:

```ts
export type HttpServiceFactory<TDeps> = (deps: TDeps) => Promise<Express.Application> | Express.Application;
```

Then MakerKit’s runtime adapter can do:

- instantiate `deps` (e.g. `{ db }`) from `bindings.resources`
- call factory to get `app`
- attach `app` to `bindings.system.ingress` (listen/serve)

## Open questions / decisions to make (TBD)

- **Descriptor format and static analysis approach**: “pure data descriptors” vs “builder DSL that produces descriptors”.
- **Code packaging/bundling**: which bundler, what module boundary rules, how to split artifacts per entrypoint.
- **Durability & retries**: what guarantees exist for scheduled functions / workflows (Convex has higher-level durable workflow components; see the scheduling page’s pointers to components ([Scheduling](https://docs.convex.dev/scheduling))).
- **Auth propagation model**: how identities flow into handlers and between services (Convex exposes auth via function context ([Actions](https://docs.convex.dev/functions/actions))).
- **Data contracts**: how MakerKit encodes stream payload schemas, DB schemas, and cross-service contracts for agents and platform enforcement.
