# TanStack DB (inspiration)

## Summary

TanStack DB is a client-side, reactive data layer centered on **normalized collections**, **live (reactive) queries**, and **optimistic mutations**. It emphasizes avoiding endpoint sprawl by making the **query** the contract for what data should be synced/loaded.

Reference: [TanStack DB Overview](https://tanstack.com/db/latest/docs/overview)

## Similarities to MakerKit

- **Streaming / realtime-first**: live queries are reactive and update as underlying data changes.
- **Derived views over normalized state**: query results behave like materialized views over collections.
- **Two-loop write model**: fast local optimistic updates, then slower persistence/confirmation.
- **Contract artifacts**: typed schemas validate data entering the system (similar spirit to our contracts + emitted artifacts).

## What we want to emulate (or adapt)

- **Collections as a primary boundary**:
  - Treat “collection” as a first-class abstraction (even if the backing store is streams + materialization rather than an in-memory store).
- **Live query semantics**:
  - Query results update incrementally when relevant facts change (not “refetch everything”).
  - Make “reactive query correctness + performance” a design constraint.
- **Optimistic mutation model**:
  - Model optimistic state as an overlay that can commit/rollback based on authoritative outcomes.
- **Sync modes as explicit product surface**:
  - Eager vs on-demand vs progressive as a clear set of trade-offs.
  - The “query is the contract” idea for on-demand/progressive sync.

## Why it’s relevant to MakerKit

- It’s a crisp, modern example of **how to make realtime feel normal** in product code.
- It provides a vocabulary for **local-first ergonomics** without demanding a specific backend architecture.
- Its on-demand/progressive ideas map well to MakerKit’s likely need to support:
  - large datasets
  - partial subscriptions
  - “fast first paint” plus background convergence

## Where it differs / caveats

- TanStack DB is a **client store**; MakerKit is a **platform/runtime + control-plane** that must define:
  - platform-facing metadata/artifacts
  - runtime execution contracts (entrypoints + bindings)
  - durable primitives (streams, checkpoints, consumer groups)
- We should treat “collection” as a concept that can be implemented via **streams + materializers**, not necessarily as the same library implementation.

## Open questions / next research

- What should MakerKit standardize about **predicate → sync contract** (query shape, filter operators, paging, joins)?
- Do we want incremental query maintenance in the core runtime, or as an optional higher-level module?
- How should optimistic transactions be represented in our emitted artifacts (if at all)?

