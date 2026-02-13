# Artifacts and manifest (domain deep dive)

## Purpose

Define the platform-facing contract that AppKit emits from the control plane:

- code artifacts (bundles/modules)
- the generated manifest / topology map (e.g. `appkit.map.json`)

## Current source material

- `docs/design/10-domains/appkit-overview.md` (Static topology inference, Interface to platform, Entrypoints)
- `docs/design/90-decisions/ADR-0002-entrypoint-execution-contract.md`

## Notes

This domain will evolve to specify:

- Artifact structure and boundaries (per entrypoint)
- Manifest schema (nodes, edges, entrypoints, bindings)
- Stability and hashing/versioning strategy
