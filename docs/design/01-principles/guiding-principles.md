# Guiding Principles

These are long-lived product/design constraints that should shape most decisions.

## Streaming-first (Convex-inspired)

MakerKit should be designed for realtime, streaming-first applications. Data should flow through services and eventually to client devices via **streams/subscriptions**, not primarily via request/response “pull” patterns.

Decisions recorded:

- **DurableStream is the backbone**: Treat Durable Streams as the primary primitive (log/topic style), and build queue/workflow semantics on top.
- **Progress tracking is first-class**: Consumer groups + checkpoints are part of the DurableStream runtime contract.

## Platform-agnostic core (adapters for Prisma and others)

MakerKit’s core framework should be **generic and general-purpose**, not specific to the Prisma deployment platform.

Prisma-specific behavior should live in **implementations/adapters** (providers, bindings resolvers, deploy/run tooling) that plug into the core through explicit interfaces.

This principle exists so that:

- the MakerKit programming model remains stable even as platform capabilities evolve
- local dev/test environments can use non-Prisma implementations without changing user code
- the platform contract is expressed through clear ports/adapters rather than implicit coupling
