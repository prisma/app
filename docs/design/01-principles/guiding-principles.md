# Guiding Principles

These are long-lived product/design constraints that should shape most decisions.

## Streaming-first (Convex-inspired)

AppKit should be designed for realtime, streaming-first applications. Data should flow through services and eventually to client devices via **streams/subscriptions**, not primarily via request/response “pull” patterns.

Decisions recorded:

- **DurableStream is the backbone**: Treat Durable Streams as the primary primitive (log/topic style), and build queue/workflow semantics on top.
- **Progress tracking is first-class**: Consumer groups + checkpoints are part of the DurableStream runtime contract.
