# ADR-0018: Config params carry a caller-owned schema, not a fixed type enum

## Status

Proposed

## Decision

A config param declares its type with a **Standard Schema** the caller supplies,
not a value drawn from a fixed `ParamType` enum. `ConfigParam` carries a `schema`
field; the param's value type is inferred from it (`StandardSchemaV1.InferOutput`),
and the schema is what validates the value. The curated `ParamType = 'string' |
'number'` and its `TypeOf` mapping are removed. A param can now hold any shape the
schema expresses — a scalar, an object, an array — with no change to core.

## Reasoning

Take a scheduled-work service that needs its schedule as configuration: a list of
`{ jobId, every }` entries, baked in at deploy so it survives every restart. That
value is a structured array. Today it has nowhere to live. `ConfigParam` is

```ts
export type ParamType = 'string' | 'number';
export interface ConfigParam<T extends ParamType = ParamType> {
  readonly type: T;
  readonly default?: TypeOf<T>;
  // secret?, optional?
}
```

so the only way to carry the schedule is to stuff a `JSON.stringify` of it into a
`string` param. That works mechanically but the graph goes blind: `configOf`
reports "one string param," topology tooling and agents can't see the schedule,
and — the part that actually costs us — a native lowering can't read the structure
to translate it, because there is no structure, only an opaque blob it would have
to re-parse by private convention.

The framework already solved exactly this problem one layer over, for RPC. A
`Contract` imposes no structure on its types; the caller supplies them, and `rpc`
takes Standard Schema validators (arktype the canonical one) straight from the
caller and simply carries them:

```ts
export function rpc<I extends StandardSchemaV1, O extends StandardSchemaV1>(m: {
  input: I;
  output: O;
}): (input: InferInput<I>) => Promise<InferOutput<O>>;
```

Config params should work the same way. The type is the caller's schema; the
framework carries it and imposes nothing:

```ts
export interface ConfigParam<S extends StandardSchemaV1 = StandardSchemaV1> {
  readonly schema: S;
  readonly default?: StandardSchemaV1.InferOutput<S>;
  readonly secret?: boolean;
  readonly optional?: boolean;
}
```

A string param is now `{ schema: type('string') }`, a number `{ schema:
type('number') }`, the schedule `{ schema: type({ jobId: 'string', every: 'string'
}).array() }`. `Values<P>` infers each value via `InferOutput`; validation runs
the schema instead of a hand-written string/number check. The scalar case stays
terse behind a helper (`string()`, `number()` returning the schema-shaped param),
so existing declarations barely change.

`secret` and `optional` stay as framework facets, not schema concerns — `secret`
governs redaction and secure placement, which is about handling the value, not
validating it.

## Consequences

- **A documented maintenance point disappears.** The core model listed "extend
  `ParamType` consciously, with its validation" as a standing extension point.
  With caller-owned schemas there is nothing to extend: a new shape is a new
  schema in user space, never a core change.
- **Core gains a type-only dependency** on `@standard-schema/spec` — the same one
  `@prisma/app-rpc` already uses. It's an interface package with no runtime; users
  bring the validator (arktype). Core stays validator-agnostic.
- **Validation moves to the schema.** The framework no longer hand-codes
  string/number coercion; `schema.validate` does it, which validates richer shapes
  than the old enum ever could.
- **This is a breaking change to every param declaration.** `ConfigParam` is also
  what dependency connection params use (`postgres`/`rpc`'s `{ url }`), and every
  service's own params. All of them migrate from `{ type: 'string' }` to the
  schema form. The `string()`/`number()` helpers keep the common case a one-word
  change.
- **Structured params are static data.** A param's own value comes from its
  declared `default`; refs to other nodes arrive through dependency inputs, not
  param fields. So a schema param cannot embed a provisioning ref — if a value
  needs another node's address, that is a dependency edge, not a param.

## Alternatives considered

- **Add a `'schema'` variant alongside `'string' | 'number'`.** Keeps the enum and
  special-cases structured values. Rejected: it preserves the maintenance point
  this decision exists to remove, and leaves two ways to say "a string." Making the
  type always a schema is simpler and strictly more general — the scalars become
  ordinary schemas.
- **Keep the enum and encode structured values as JSON strings.** The pragmatic
  hack. Rejected: it is graph-blind (introspection and native lowering can't see
  the structure) and pushes the stringify into user code. The whole point of a
  first-class type is that the structure survives into the graph.

## Related

- [`ADR-0019`](ADR-0019-the-target-owns-config-serialization.md) — how a
  schema-typed value is serialized: the target owns it, over key/value string
  pairs.
- [`ADR-0015`](ADR-0015-dependencies-resolve-to-bindings-clients-are-app-side.md) —
  the binding model params feed into.
- [`connection-contracts.md`](../10-domains/connection-contracts.md) — the
  `Contract`/`rpc` caller-owned-type idiom this mirrors.
- [`config-params.md`](../10-domains/config-params.md) — the params model in full.
