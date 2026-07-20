# ADR-0033: The RPC kind is named service RPC

## Status

Accepted

## Decision

The framework's RPC kind is named **service RPC**. The authoring surface
moves from `@prisma/composer/rpc` to `@prisma/composer/service-rpc` (internal
package `@internal/service-rpc`). The short authoring names — `rpc()`,
`contract()`, `serve()` — are unchanged: they are already namespaced by the
import, and call-site brevity is part of the kind's design. The kind brand
stays `'rpc'`; it is an internal identifier, not prose. In documentation the
kind is called "service RPC" on first mention.

## Reasoning

Bare "RPC" names the general concept, so it invites evaluation against
general-purpose RPC frameworks (tRPC, oRPC, gRPC) and general
distributed-systems standards. Two independent, competent proposals made
exactly that category error in one month: one optimized the kind as an
application API layer (adopt oRPC's full authoring model, PR #114), one as
arbitrary-network infrastructure (durable exactly-once delivery). Both were
correct answers to a misread scope. When the same misconception recurs across
independent minds, the name is underspecified.

"Service" names what the kind connects — services inside one deployed
application — the same instinct as Cloudflare's "service bindings" or
Kubernetes' cluster-internal services. It was preferred over "internal-rpc",
which names what the kind excludes and wrongly implies a sibling external
kind, and over renaming the call-site functions, which would tax the
trivial-by-design surface the name exists to protect.

The scope itself is recorded in
[connection-contracts.md](../10-domains/connection-contracts.md) ("Purpose
and scope"): Connections are internal by definition; the kind's primary
consumers are agents generating services and the framework connecting them;
it is neither an application API layer nor general distributed-systems
infrastructure.

## Consequences

- `@prisma/composer/service-rpc` is the public subpath; `./rpc` is gone
  (pre-adoption, no compatibility alias).
- The internal package and directory are
  `packages/0-framework/2-authoring/service-rpc` (`@internal/service-rpc`).
- Call sites are unchanged: `import { rpc, contract, serve } from
  '@prisma/composer/service-rpc'`.
- Proposals for this kind calibrate against the recorded scope first;
  "feature X exists in general-purpose RPC frameworks" is not, by itself, a
  reason to add it.

## Related

- [ADR-0025](ADR-0025-name-the-unit-of-composition-module.md) — naming
  registers precedent.
- [ADR-0030](ADR-0030-rpc-callers-verified-with-an-auto-provisioned-service-key.md)
  — the per-edge service key every network binding carries.
- [connection-contracts.md](../10-domains/connection-contracts.md) — the
  kind's design and its Purpose and scope.
