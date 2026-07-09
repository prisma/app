# Architecture Decision Records (ADRs)

This directory contains append-only decision records.

## When to write an ADR

Write an ADR when we “pick an answer” that future readers will need to understand and reference (even if the decision is provisional).

Keep ADRs short:

- Context
- Decision
- Rationale
- Consequences
- Alternatives

## Index

_Earlier drafts (ADR-0001, ADR-0002) were retired as the high-level design settled._

- [ADR-0003](ADR-0003-deploy-derives-everything-from-the-root-node.md) — `makerkit deploy` derives everything from the root node; there is no deploy config file.
- [ADR-0004](ADR-0004-paths-resolve-relative-to-the-authoring-file.md) — Paths resolve relative to the file that writes them; the build adapter carries the authoring module.
- [ADR-0005](ADR-0005-users-build-makerkit-assembles.md) — Users build their app; MakerKit assembles deploy artifacts from built output.
- [ADR-0006](ADR-0006-every-node-is-named.md) — Every node is named; the root's name names the application.
- [ADR-0007](ADR-0007-deploy-drives-alchemy-through-a-generated-stack-file.md) — Deploy drives Alchemy through a generated, inspectable stack file.
- [ADR-0008](ADR-0008-wrapper-inlines-everything-except-runtime-builtins.md) — The boot wrapper inlines everything except runtime built-ins.

