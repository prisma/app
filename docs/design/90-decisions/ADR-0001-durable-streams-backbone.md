# ADR-0001: Durable Streams are the backbone

## Status

Accepted

## Context

Realtime and streaming communication is a core characteristic of the Prisma Platform and AppKit. We want trivial streaming primitives:

- Between compute services
- From DB to compute
- From compute to clients

We expect Durable Streams to be the backbone primitive. Request/response can be built on top of streams, but adding streaming later to a request/response-first system is much harder.

## Decision

- Treat **DurableStream as the primary primitive** for communication and data access.
- Model DurableStream as a **log/topic (A)** primitive.
- Build **queue/workflow semantics (B)** as a library layer on top of DurableStream.
- Include **consumer groups + checkpoints** as **first-class** in the DurableStream runtime contract.

## Rationale

- Keeps the system centered on one composable primitive (stream) rather than multiple competing communication models.
- Makes streaming-first applications the default, while still allowing request/response adapters.
- First-class progress tracking prevents each application from re-implementing correctness for queue-like patterns.

## Consequences

- Streams appear as **first-class resources** in the topology graph and are injected (no globals).
- “Work queue” patterns become conventions over groups/checkpoints rather than a separate core primitive.
- Client delivery will likely use transports like SSE/WebSockets, but the semantic model remains stream/subscription-first.

## Alternatives considered

- Durable Streams as a queue/workflow primitive: rejected; we want queues/workflows layered on top of a log/topic backbone.
- Request/response-first with streaming as an add-on: rejected; doesn’t match platform goals.

## Links

- Principles: `docs/design/01-principles/guiding-principles.md`
- Overview: `docs/design/10-domains/appkit-overview.md`
