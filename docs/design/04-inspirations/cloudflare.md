# Cloudflare platform (inspiration)

## Summary

Cloudflare Workers (and the broader platform) are a strong reference for “deploy code to the edge” with a cohesive set of managed primitives and a highly polished developer workflow.

## Similarities to MakerKit

- **Platform primitives**: a set of managed capabilities (compute, storage, messaging) that apps compose.
- **Clear boundaries between authoring and running**:
  - author-time: describe/configure/build/deploy
  - runtime: execute requests/events with bound resources
- **Strong tooling expectations**: the tooling is part of the product.

## What we want to emulate (or adapt)

- **Opinionated, end-to-end workflow**:
  - A single “happy path” for author → validate → build artifacts → deploy → run.
- **Explicit resource binding**:
  - Treat platform-provisioned resources as explicit bindings (not “discover via globals”).
- **Operational clarity**:
  - Users should understand what gets deployed (artifacts), what runs (entrypoints), and how it scales.

## Why it’s relevant to MakerKit

- MakerKit needs a similarly crisp story for:
  - what gets compiled/emitted at control-plane time
  - what gets executed at runtime
  - how platform resources are attached to code

## Where it differs / caveats

- Cloudflare’s platform is edge-first; MakerKit’s primary environment is the Prisma Platform (with its own primitives and constraints).
- We should copy the **product shape** (workflow clarity, explicit contracts) more than any single underlying implementation.

## Open questions / next research

- Which Cloudflare primitives map best onto MakerKit concepts (streams, storage, workflows/queues, ingress)?
- How does Cloudflare communicate “what is deployed” and “what is bound” in a way we can emulate in our artifacts/manifest model?

