# Cloudflare Wrangler (inspiration)

## Summary

Wrangler is Cloudflare’s “control-plane UX”: it’s the CLI/tooling layer that makes the platform usable end-to-end. It’s a useful reference for how to integrate:

- validation and configuration
- build/packaging
- deployment orchestration
- local dev workflows

## Similarities to MakerKit

- **Control-plane tooling**: MakerKit needs a comparable “author-time” surface for inspecting descriptors, validating topology, and emitting artifacts.
- **Artifact-first deployment**: Wrangler is a strong example of how tooling revolves around stable artifacts/config, even when the authoring input is higher-level.
- **Developer experience as a product**: the CLI is not incidental.

## What we want to emulate (or adapt)

- **Clear artifact boundary**:
  - make it obvious what the “deployment unit” is (our equivalent of an emitted topology map + bundle).
- **Human-friendly validation**:
  - errors should be actionable and tied back to the authoring source (TypeScript descriptors).
- **Local dev parity**:
  - a local mode that uses the same conceptual model and contracts as production.

## Why it’s relevant to MakerKit

- MakerKit’s core bet is a two-plane architecture; Wrangler is a strong, pragmatic example of what a polished control-plane tool can feel like.

## Where it differs / caveats

- Wrangler’s input is largely config-centric; MakerKit’s source of truth is code-first descriptors and inferred topology.
- We should be careful not to regress into “hand-authored manifest as truth”; our manifest/artifacts should remain **generated**.

## Open questions / next research

- What should our “Wrangler equivalents” be (commands, outputs, error styles)?
- What are the minimal stable artifacts we need to standardize early (topology map, contracts, bundles)?

