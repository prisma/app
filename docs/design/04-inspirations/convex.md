# Convex (inspiration)

## Summary

Convex is a realtime backend that emphasizes a tight, integrated developer experience: a unified programming model for backend functions, data, and reactive updates to clients.

## Similarities to MakerKit

- **Realtime as a default**: reactive data flows and subscriptions are a core product story.
- **“Application as code”**: code-first definition of behavior rather than a pile of hand-authored manifests.
- **Ergonomics-first**: a cohesive workflow that reduces integration glue.

## What we want to emulate (or adapt)

- **Developer inner-loop**:
  - Make the default experience “it just works” for realtime, without requiring manual wiring.
- **Clear execution model**:
  - A crisp story for “what runs where” and “how it’s invoked” (maps to entrypoints + bindings).
- **Typed contracts as leverage**:
  - Lean on types/contracts to power tooling, agent workflows, and safe refactors.

## Why it’s relevant to MakerKit

- Convex is a strong existence proof that:
  - realtime-first ergonomics can be a mainstream default
  - a coherent platform story can beat a set of loosely coupled primitives

## Where it differs / caveats

- MakerKit is explicitly designed around a **two-plane architecture** (control vs execution) and platform-provisioned bindings.
- MakerKit treats **streams** as the primary primitive, with higher-level models built on top.

## Open questions / next research

- Which parts of Convex’s developer workflow are “product surface” vs “implementation detail”?
- What are Convex’s sharp edges at scale (data volume, fanout, multi-tenant isolation) that we should design around early?

