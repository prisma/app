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
- [ADR-0004](ADR-0004-service-nodes-carry-their-authoring-url.md) — Every path resolves relative to the file that writes it; the build adapter carries the authoring module (amended — supersedes the original nearest-`package.json` anchor).
- [ADR-0005](ADR-0005-users-build-makerkit-assembles.md) — Users build their app; MakerKit assembles deploy artifacts from built output.
- [ADR-0006](ADR-0006-every-node-is-named.md) — Every node is named; the root's name names the application.

