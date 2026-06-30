# Glossary (ubiquitous language)

The shared terms used across MakerKit's design docs. This is the **authoring
plane** vocabulary — what a developer writes and thinks in. For how these lower
to the substrate and hosting planes, see `layering.md`.

## Core nouns

### Hex (Subsystem)

The unit of composition: a **bounded context** that wraps some Services and
Resources, exposes **Inputs** and **Outputs**, and is connected to other Hexes
only through them. A Hex can contain one or many Services, and Hexes can nest.

- "Hex" is the working name; **Subsystem** is the literal fallback.
- A Hex is an *authoring/reasoning* unit. It is not a single deployed object — it
  lowers to a subgraph of hosting primitives (see `layering.md`).

### Service

A compute unit: an entrypoint that runs code, with HTTP ingress/egress. The
atomic *runnable*. Lowers to a compute unit on the chosen deployment target —
Prisma Compute on Prisma Cloud, or another target's equivalent.

### Resource

A provisioned, stateful platform primitive a Hex depends on. **Modeled as an
Alchemy resource, surfaced as a typed capability**: a Resource's Output provides a
capability (via an Alchemy Layer); a Hex's Input requires one; the wire is valid
iff provided satisfies required.

- **First-class**: Prisma **Postgres** (data, via Prisma Next contracts) —
  MakerKit-native treatment.
- **BYO**: any Alchemy resource (object storage, cache, queue, third-party)
  exposed through a capability Layer. The Hex depends on the capability, not the
  vendor — this is how a Hex uses, e.g., file storage today.

Not Resources: **Compute** is what a Service lowers to (one per deployment target
— Prisma Compute on Prisma Cloud), and a **Stream** is a connection style, not a
declared resource.

See `layering.md` → Resources: first-class vs BYO.

### Topology

The graph of Hexes and Resources wired together through their Inputs and Outputs.
MakerKit infers it from TypeScript and emits it as a static artifact for the
platform to provision.

## Connections

A **connection** is an edge that wires one node's **Output** to another node's
**Input**. Every node — Hex or Resource — can have Inputs and Outputs. There are
two families of connection.

### Input

A connection point where a node **requires** something. Either a *communication*
Input (consumes another node's Output) or a *Data* Input (consumes a Resource's
Data Output).

### Output

A connection point where a node **provides** something. Communication Outputs are
served by Hexes; Data Outputs are served by Resources.

### Communication connection — style: request/response | stream

A Hex-to-Hex (or public/external) connection. Its **style** is a property of the
connection:

- **request/response** — synchronous. Contract = the API/RPC signatures.
- **stream** — asynchronous, durable events. Contract = the payload schema.

The communication style is *not* mediated by a Resource; the underlying transport
(durable stream infra, etc.) is a lowering detail, never a modeled node.

### Data connection — method: TCP | HTTP

A Hex consuming a Postgres Resource.

- A **Data Input** (on a Hex) = a **connection method** (`TCP` — direct Postgres
  wire; `HTTP` — PostgREST-style) plus a **Data Contract** it must satisfy.
- A **Data Output** (on a Postgres Resource) = the set of **contract hashes** the
  Resource is provisioned (and verifiable) to satisfy.
- The wire is valid iff the Output's offered hashes satisfy the Input's contract.
- The concrete connection (URL) is injected when wired — never embedded in the Hex
  (no-globals).

### Ingress / Egress

The public/external face of a communication connection. **Ingress** = a
request/response Output exposed to the public (e.g. the website). **Egress** = a
request/response Input that targets an external service.

## Contracts

### Data Contract

A **Prisma Next** contract — a deterministic, hashable description of the schema
slice a Hex may access (identified by its `storageHash`). A Hex's Data Input
declares the contract it requires; this is also the per-Hex least-privilege scope.

### Aggregate Contract

When several Hexes share one Postgres, the Resource must satisfy the **aggregate**
of their contracts. Ownership overlap is **prohibited** (a Prisma Next concept).
The cloud can verify the live DB satisfies the aggregate via the marker/ledger.

## Planes & process

### Authoring / Substrate / Hosting planes

The three layers MakerKit spans: what you write (MakerKit), how it's wired and
provisioned (Alchemy/Effect), what runs (Prisma Cloud). See `layering.md`.

### Lowering

The compilation from one plane to the next: authoring topology → substrate
resource graph → hosting primitives. Analogous to Prisma Next lowering a contract
to a plan.

### Control plane / Execution plane

Two MakerKit modes. **Control plane**: import the topology, validate, build the
graph, emit the artifact, drive provisioning/inspection. **Execution plane**:
instantiate implementations, satisfy the graph, inject dependencies, run
entrypoints. Kept as separate import surfaces to avoid drift (and for
tree-shaking).

### Entrypoint

An addressable unit the platform can execute (by id/kind), defined by an artifact
reference plus its declared required Inputs. The execution-plane handle for a
Service.

## Deferred / open

- **Connection-method taxonomy** — only `TCP` and `HTTP` for now. "Pooled" is a
  URL param on TCP, not its own method; WebSocket and others are deferred until we
  work more examples.
- **Encapsulation as convention** — "one Hex owns a Data Resource" and "a Hex
  never exposes raw data to peers (front it behind communication)" are
  *conventions/policy* we may layer on, not enforced primitives.
- **Input/Output type set** — deliberate and curated, added consciously; not an
  open plugin surface, but not sealed forever either.

## Superseded terms

- **App** → use **Topology** (the wired graph) or **Hex** (a unit).
- **Descriptor** → an internal/substrate term; avoid in the authoring vocabulary
  (and note Prisma Next uses "Descriptor" for its own components).
- **Durable Stream as "the backbone"** → streams are *one of two* transports
  (alongside request/response), not the universal substrate. See the streaming
  reconciliation note in the decisions log.
