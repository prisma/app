# Ingress (domain deep dive)

## Purpose

Define how external traffic enters an MakerKit application (e.g. public HTTP) as a first-class node in the topology graph.

## Current source material

Ingress is discussed implicitly via the entrypoint execution contract:

- `docs/design/90-decisions/ADR-0002-entrypoint-execution-contract.md`
- `docs/design/10-domains/makerkit-overview.md` (entrypoint model requires system bindings like ingress)

## Notes

This domain doc will evolve as we decide:

- What ingress kinds exist (HTTP, WebSocket/SSE gateways for streaming-first clients, etc.)
- How ingress binds to services (routing granularity, service-level vs endpoint-level)
- Which bindings are “system” vs “resource” bindings in the execution contract
