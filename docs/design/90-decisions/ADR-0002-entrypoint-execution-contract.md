# ADR-0002: Entrypoint execution contract (platform → AppKit)

## Status

Accepted

## Context

The Prisma Platform will:

- Provision dependencies (e.g. Prisma Postgres, ingress, streams)
- Stage the user’s code artifact(s) onto compute (VM with Bun)
- Load AppKit’s topology/manifest metadata

The platform needs a clear, minimal contract to say:

> “Execute entrypoint `X`, and here are the provisioned bindings for its dependencies.”

This is also where AppKit performs dependency injection under the “no globals” principle.

## Decision

- Model **entrypoints** as first-class, addressable units (by id) described in AppKit’s emitted metadata.
- An entrypoint includes:
  - **id**
  - **kind** (http-service, worker, subscriber, cron, etc.)
  - **artifact reference** (bundle/module/export)
  - **declared required bindings** (resources + system bindings)
- At runtime, the platform calls AppKit with:
  - `entrypointId`
  - `artifactRoot`
  - a bindings map of provisioned dependency instances

## Rationale

- Makes platform execution explicit and automatable.
- Centralizes DI at the execution boundary (user code never discovers dependencies via globals).
- Keeps control-plane descriptor graph and execution-plane instances aligned via declared bindings.

## Consequences

- The manifest (`appkit.map.json`) must list entrypoints and their required bindings.
- AppKit runtime must validate bindings and inject dependencies deterministically.

## Alternatives considered

- “Run the whole app” with implicit startup: rejected; needs finer-grained platform control (by entrypoint).
- Environment-variable based binding discovery: rejected; violates “no globals”.

## Links

- Principles: `docs/design/01-principles/architectural-principles.md`
- Overview: `docs/design/10-domains/appkit-overview.md`
