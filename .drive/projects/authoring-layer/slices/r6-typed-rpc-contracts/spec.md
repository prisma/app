# Slice R6 — typed RPC connection contracts

## At a glance

```ts
// auth.contract.ts — the shared Contract value (arktype I/O; RPC-shaped)
export const authContract = contract({
  verify: rpc({ input: type({ token: "string" }), output: type({ ok: "boolean" }) }),
})

// auth: provider — declares + serves the contract
export default compute({ build: node({ entry: "server.js" }), expose: { rpc: authContract } })
// server.ts: export default serve(service, { rpc: { verify: async ({ token }, { db }) => ({ ok: … }) } })

// storefront: consumer — requires it, calls it typed
export default compute({ deps: { auth: rpc(authContract) }, build: nextjs({ entry: "server.js" }) })
// page.tsx: const { auth } = service.load(); await auth.verify({ token })   // typed both ways

// the hex wiring is compile-checked: auth's exposed contract must satisfy storefront's slot
h.provision("storefront", storefront, { auth: authRef.rpc })
```

The untyped `http()` stays as the escape hatch. `rpc(contract)` is the typed refinement.

## Chosen design

The rewritten [`connection-contracts.md`](../../../../docs/design/10-domains/connection-contracts.md)
and its **compiled proof** [`contract-satisfaction.poc.ts`](../../../../docs/design/10-domains/contract-satisfaction.poc.ts).
In brief: a framework-owned `Contract<Kind, Cmp>` (opaque `Cmp` + `kind` brand +
runtime `satisfies()`); the core's compat check is plain assignability with `NoInfer`
on the brand; the RPC kind makes it correct by building `Cmp` as a **concrete function
map** (`rpc()` returns a concrete `(input) => Promise<output>`), so TS applies
contravariant-input / covariant-output. A provider exposes a record of contract-typed
output ports; `serve(service, handlers)` generates the server and forces the handlers
to satisfy the exposed contracts; the consumer's `load()` returns the typed client.
Deviations amend the docs with the operator first.

## Coherence rationale

One PR: the typed connection, end to end, proven live on storefront-auth (storefront
renders auth's `verify` result via a typed `auth.verify()` call over generated RPC).
Large but a single capability; the dispatch plan orders it so each unit is bounded.

## Scope

**In:**
- **core**: `Contract<Kind, Cmp>` type (+ `satisfies` shape); `expose` on `ServiceNode`
  (record of named output ports → contracts); the typed `HexBuilder.provision` wiring
  check (proven mechanism: `wiring: { [K]: NoInfer<Deps[K]> }`, plain assignability);
  `ProvisionedRef` carries the exposed ports; a service's `Deps` may hold `rpc`
  connection ends. `http()` (untyped) unchanged.
- **NEW package `@makerkit/rpc`** (the RPC kind, target-agnostic):
  - `contract(fns)` / `rpc({ input, output })` — `rpc()` returns a concrete
    `(input: I) => Promise<O>` at the type level and carries the arktype schemas at
    runtime; `contract()` → `Contract<"rpc", Fns>`.
  - `Client<C>` — the typed client the consumer gets; the connection end `rpc(contract)`
    hydrates to it.
  - **client binding** (network adapter): the typed client makes RPC-over-HTTP calls
    to the resolved URL (`POST <base>/rpc/<method>`, JSON body, arktype-validate the
    response); wire format is pack-private.
  - `serve(service, handlers)` — generates the RPC server (a `fetch` handler:
    dispatch `POST /rpc/<method>` → arktype-validate input → handler → validate output),
    calling `load()` for the deps and passing them to handlers; forces handlers to
    satisfy every exposed contract; extra methods allowed.
  - **Standard Schema / arktype** for I/O.
- **examples/storefront-auth**: `auth` exposes + serves `authContract` (verify);
  `storefront` requires `rpc(authContract)` and its page calls `auth.verify({token})`
  typed; the hex wiring compat-checks. auth's `server.ts` uses `serve()`.
- **type tests**: the POC's accept/reject cases as real tests in `@makerkit/rpc`
  (exact/extra-output/extra-method accepted; extra-input/missing/wrong-kind rejected).
- **Deploy proof**: storefront-auth live on real Prisma Cloud; storefront renders the
  round trip via the typed `auth.verify()`; destroy clean.

**Out:** in-memory + mock bindings (network only); structural `satisfies` (nominal —
identity/version, kind-internal); gRPC / WebSocket / GraphQL kinds; PDL authoring;
contract error schemas; distributed published-spec comparison; hex boundary-port
forwarding; multi-output selection ergonomics beyond a named port.

## Dispatch plan (ordered)

1. **core + `@makerkit/rpc` types + compat + type tests** — the proven mechanism made
   real, no runtime. Green typecheck + type tests.
2. **`@makerkit/rpc` runtime** — `serve()` (fetch server + arktype validation) + the
   client binding (RPC-over-HTTP) + the `rpc(contract)` connection end hydrate.
3. **examples retrofit** — auth provider (expose + serve), storefront consumer (typed
   call), hex wiring.
4. **deploy/verify/destroy + Opus review**.

## Pre-investigated edge cases

- **The variance trap** — do NOT parameterise the contract by the schema map and derive
  `Client<M>` (mapped-type comparison relates M covariantly, silently accepts bad
  providers). `Cmp` MUST be a concrete function map from `rpc()`. Proven; keep the type
  tests as the guard.
- **`NoInfer` on the kind brand** in `provision`, or cross-protocol wiring co-infers a
  union and passes.
- **arrow-property signatures + `strictFunctionTypes`** — the repo tsconfig has it;
  method-shorthand would be bivariant and defeat the input check.
- **`serve` needs the deps** — it calls `load()` and passes deps to handlers; the
  provider never calls `load()` itself.
- **Client resolves a URL** — the `rpc(contract)` connection end's config is the
  producer's URL (same wiring as `http()`), and the client posts to it; unchanged Load
  sequencing.

## Slice-DoD

The At-a-glance code deploys live; storefront renders auth's `verify` result through a
typed `auth.verify()` over generated RPC; the hex wiring rejects an incompatible
provider at compile time (type test); `http()` still works untyped; all gates + type
tests green; docs already match; PR open, review loop complete.

## References

- `docs/design/10-domains/connection-contracts.md` (design) · `contract-satisfaction.poc.ts` (proof)
- `core-model.md` (the Connection/http primitive R6 types) · `design-notes.md`
