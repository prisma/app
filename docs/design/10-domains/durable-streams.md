# Durable Streams (domain deep dive)

## Purpose

Define the Durable Streams model as the primary communication and data access primitive for AppKit and the Prisma Platform.

## Current source material

- `docs/design/01-principles/guiding-principles.md` (streaming-first)
- `docs/design/90-decisions/ADR-0001-durable-streams-backbone.md`
- `docs/design/10-domains/appkit-overview.md` (Durable Streams backbone section)

## Notes

This domain doc will evolve as we define:

- Stream descriptor shape (control plane)
- Stream runtime interface (execution plane)
- Consumer group + checkpoint semantics
- Patterns layered on top (queues/workflows)
