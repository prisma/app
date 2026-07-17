# ADR-0033: Composer RPC adopts native oRPC v2 contracts and runtime

## Decision

Composer RPC uses oRPC v2 as its public contract-first programming model and
its wire runtime. `@prisma/composer/rpc` re-exports `oc` for contract authoring
and `implement()` for server routers. Composer's small `contract()` wrapper
retains the exact native router while adding the identity and inferred client
shape required by the application topology.

```ts
import { contract, implement, oc, serve } from '@prisma/composer/rpc';
import { type } from 'arktype';

export const ordersContract = contract({
  place: oc.input(placeOrder).output(placedOrder),
  admin: {
    cancel: oc.input(type({ orderId: 'string' })).output(type({ cancelled: 'boolean' })),
  },
});

const rpc = implement(ordersContract.router);
const router = rpc.router({
  place: rpc.place.handler(({ input }) => place(input)),
  admin: rpc.admin.router({
    cancel: rpc.admin.cancel.handler(({ input }) => cancel(input.orderId)),
  }),
});

export default serve(service, { rpc: router });
```

The consumer still declares topology with `rpc(ordersContract)`. Its
`service.load()` result is oRPC's inferred native client, including the same
nested shape (`orders.admin.cancel(...)`).

oRPC owns procedure schemas, nesting, middleware, metadata, typed errors,
request/response codecs, Fetch routing, Standard Schema execution, and
cancellation. Composer owns application topology, nominal contract matching,
dependency hydration, per-edge service-key authorization, mount policy,
cross-port path collision checks, and request limits.

The oRPC packages are exact-version runtime dependencies while v2 is beta.
Applications import the supported API from `@prisma/composer/rpc`, avoiding
multiple incompatible oRPC versions in one graph.

## Reasoning

The previous Composer-specific `rpc({ input, output })` procedure DSL hid oRPC
behind a thin adapter. That kept a small surface, but it also discarded the
main reason to adopt an RPC ecosystem: users could not naturally use native
routers, nesting, middleware, contract metadata, typed error declarations, or
ecosystem tooling. Composer would eventually have had to mirror each feature
with another abstraction.

Native oRPC fits Composer's boundary directly. A Composer service exposes a
contract router as a typed output port; a consumer requires that same router
through `rpc(contract)`; and the server implements it with oRPC. Composer adds
only the deployment facts oRPC cannot know: which services are connected,
which URL and capability key hydrate that edge, and which router belongs to
which exposed topology port.

`serve()` accepts one native contracted router per exposed RPC port. It checks
that each implementation was created from that port's exact `contract.router`,
filters dispatch to procedures declared by the contract, and rejects duplicate
full procedure paths across ports. An implementation object therefore cannot
publish a procedure that is absent from the topology contract.

Authorization runs after a route is matched but before its body is decoded.
An unwired caller receives `401` without invoking validation or application
code. Wrong methods, schema failures, expected oRPC errors, unexpected errors,
and body limits then use oRPC's normal production behavior.

## Consequences

- Contract and server authoring use native oRPC syntax. This intentionally
  replaces Composer's earlier procedure and handler-map DSL while the project
  is still pre-adoption.
- Native nested routers are preserved. The default wire path is
  `/rpc/<procedure/path>` and the client has the same nested object shape.
- Standard Schema transforms execute once through oRPC. Handlers receive the
  input schema's output type, return the output schema's input type, and clients
  receive the transformed output.
- Expected remote failures use `RpcError` (an `ORPCError` re-export) and retain
  their code and intentional message. Unexpected exceptions are masked as
  `INTERNAL_SERVER_ERROR`.
- Client calls can carry an `AbortSignal`. Encoded request bodies are limited
  to one mebibyte by default with an explicit `serve()` override.
- `serve()` returns a Web Fetch handler, so Bun, Hono, Next.js, and other
  Fetch-capable frameworks need no Composer-specific framework adapter.
- `contract.router` stays a native oRPC router and can be consumed by opt-in
  oRPC ecosystem tooling. Composer does not bundle an OpenAPI/REST handler yet;
  that public ingress surface remains a separate product decision.
- Provider and consumer artifacts must use compatible Composer/oRPC versions;
  hand-authored requests are not a supported client contract.

## Alternatives considered

- **Keep the Composer procedure DSL over oRPC.** Rejected because it hides
  oRPC's useful authoring model and makes Composer reproduce upstream features.
- **Continue the hand-written JSON protocol.** Rejected because Composer would
  own codec correctness, cancellation, safe errors, transforms, limits, and
  compatibility without creating differentiated value.
- **Let oRPC own topology or service authorization.** Rejected because those
  are deployment-graph facts. They belong to Composer and its target, not an
  application RPC library.
- **Bundle OpenAPI immediately.** Deferred. Native contracts remove the
  architectural blocker, but public HTTP authentication, route semantics,
  documentation exposure, and lifecycle need an explicit design.

## Related

- [ADR-0015](ADR-0015-dependencies-resolve-to-bindings-clients-are-app-side.md) —
  Composer constructs protocol clients while resolving dependency bindings.
- [ADR-0030](ADR-0030-rpc-callers-verified-with-an-auto-provisioned-service-key.md) —
  the per-edge service key Composer continues to attach and validate.
- [ADR-0005](ADR-0005-users-build-the-framework-assembles.md) — application
  frameworks and their runnable builds remain user-owned.
