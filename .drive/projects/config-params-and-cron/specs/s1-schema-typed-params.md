# S1 — Config-model change: schema-typed params + target serialization

One PR. Realizes ADR-0018 and ADR-0019 together (they co-touch the same files and
must land in one green step). Design of record:
[ADR-0018](../../../../docs/design/90-decisions/ADR-0018-config-params-carry-a-caller-owned-schema.md),
[ADR-0019](../../../../docs/design/90-decisions/ADR-0019-the-target-owns-config-serialization.md),
[config-params.md](../../../../docs/design/10-domains/config-params.md). Linear: TML-3007.

## Summary

Replace the `ParamType = 'string' | 'number'` enum with caller-owned Standard
Schema on `ConfigParam`, route serialization through param-owned
`serialize`/`deserialize` over key/value string pairs (owned by the target), and
open `compute()` to user params. After this slice a service can declare a
**structured, schema-typed param** that round-trips deploy → env → boot →
`load()`, validated, and `configOf` reports its schema.

## The type change (`packages/app/src/config.ts`)

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec';

export interface ConfigParam<S extends StandardSchemaV1 = StandardSchemaV1> {
  readonly schema: S;
  readonly secret?: boolean;
  readonly optional?: boolean;
  readonly default?: StandardSchemaV1.InferOutput<S>;
  // value ↔ key/value string pairs. Owned by the target (see § serializers).
  serialize(value: StandardSchemaV1.InferOutput<S>): Record<string, string>;
  deserialize(pairs: Record<string, string>): StandardSchemaV1.InferOutput<S>;
}

export type Params = Record<string, ConfigParam>;
```

- Delete `ParamType` and `TypeOf`.
- `Values<P>` infers each value via `StandardSchemaV1.InferOutput<P[K]['schema']>`,
  keeping the existing optional/default widening (optional-without-default →
  `| undefined`).
- Add core dep `@standard-schema/spec` (type-only; already used by `@prisma/app-rpc`).
- Update `packages/app/src/index.ts` exports: drop `ParamType`/`TypeOf`, keep
  `ConfigParam`; export the `Values`/`Params` types as before.
- `packages/app/src/node.ts` `freezeParams` keeps working over the new shape (it
  copies params; extend it to preserve `serialize`/`deserialize`).

## The serializer key namespace: keep it, route through the param

Serialization touches **three** sites today, each stringifying by hand. All three
must route through the param's `serialize`/`deserialize` instead, while keeping
`configKey`'s `ADDRESS_OWNER_NAME` namespacing:

1. **Deploy-side encode** — `packages/app-cloud/src/control.ts` `serialize` (the
   `ServiceLowering.serialize`): today `value: typeof value === 'number' ?
   String(value) : value`. Route through the param's `serialize`.
2. **Boot-side decode** — `packages/app-cloud/src/serializer.ts` `deserialize` /
   `coerce`: today coerces by `type`. Route through the param's `deserialize`.
3. **Boot-side re-emit** — `serializer.ts` `stash`: today `String(value)` under
   address-free keys. Route through the param's `serialize`.

The param's `serialize` returns a `Record<string, string>` of **key suffixes** →
values (suffix `''` = the base key `configKey(...)` itself); the target composes
`baseKey + suffix`. **v1 uses a single entry (`''`)** — one env var per param, as
today. Multi-key fan-out is a deliberate non-goal for this slice (see below), but
the interface leaves room for it.

Accessing the param's `serialize`/`deserialize`: the serializer already has the
node. Work off the node's raw `ConfigParam`s (`node.params` and each
`node.inputs[k].connection.params`) — which carry the functions — using `configKey`
for naming. Keep `configOf` / `ConfigDeclaration` as the **pure-data introspection
artifact**: replace its `type: ParamType` with a JSON-Schema projection of the
param's schema (for introspection), not the functions.

## LANDMINE — preserve provisioning-ref pass-through

`control.ts:174` passes dependency-input values through untouched because at deploy
a connection param's value (a `url`) is a **provisioning ref**, not a literal
string — Alchemy resolves it and it carries the ordering edge. Only **service-own**
params (`port`, and later `jobs`) are literals that get encoded.

Therefore the **`string` serializer must be pass-through** (`(v) => ({ '': v as
never })`) so a ref flows to the `EnvironmentVariable` value unchanged. `number` and
structured serializers encode literals (`String`, `JSON.stringify`) and are only
ever applied to service-own literals (never refs — structured params carry no refs
per ADR-0018). A test must prove a dependency `url` still deploys as a ref, not a
stringified object.

## Helpers and the target param constructor

- **Core** exports `string(opts?)` and `number(opts?)` — the common scalars, with
  the pass-through `string` serializer and the `String`/`Number` `number`
  serializer. These are target-agnostic (they work for any key/value-string medium;
  v1 has one target).
- **`@prisma/app-cloud`** exports `param(schema, opts?)` — builds a `ConfigParam`
  from an arbitrary schema with app-cloud's structured serializer (`{ '':
  JSON.stringify(v) }` on the way out; `JSON.parse` + `standardValidate(schema, …)`
  on the way back). This is the Compute-param constructor `defineSchedule` (S2) will
  use; ADR-0019's "the param is the target's type" is realized here.
- Reuse `standardValidate` from `packages/app-rpc/src/standard-schema.ts` for the
  boot-side validate (or lift it to a shared spot).

## `compute()` opens to params (`packages/app-cloud/src/compute.ts`)

- Add an optional `params` field to `compute()`'s `def`, merged with the reserved
  `computeParams` (`port`). A user `params` key colliding with a reserved name
  (`port`) fails at authoring, mirroring the existing dep-collision check.
- `port` migrates to the new shape (`number({ default: 3000 })`).

## Migrate the existing declarations

Four sites, via the helpers:
`packages/app-cloud/src/http.ts:29` and `packages/app-rpc/src/rpc.ts:37`
(`{ url: string() }`), `packages/app-cloud/src/postgres.ts:55` (`{ url: string({
secret: true }) }`), `packages/app-cloud/src/compute.ts:6` (`port` → `number({
default: 3000 })`). Update the matching `postgres.ts` type annotation.

## Definition of done

- [ ] A service declares a **structured** param (via `app-cloud`'s `param(schema)`)
      and its value round-trips deploy → env var → boot `deserialize` →
      schema-validated value out of `load()`. A test drives this end to end (unit
      over serialize/deserialize is enough; no live deploy required).
- [ ] `configOf` reports a structured param's **schema projection**, not "a string".
- [ ] A dependency `url` still deploys as a **provisioning ref** (the landmine
      test), and the storefront-auth example's config is unchanged in shape.
- [ ] `compute()` accepts user params; `port` still works; a `port` collision throws
      at authoring.
- [ ] Core contains no `ParamType`/`TypeOf` and never stringifies a value; encoding
      lives entirely in the target.
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm test` green from a clean tree.

## Non-goals (this slice)

- **Multi-key fan-out** — v1 is one env var per param (suffix `''`); the interface
  allows more but nothing implements the prefix-scan yet.
- **Cron** — S2.
- **A second target** — the scalar helpers' serializers are target-agnostic for now;
  target-specific scalar serialization is revisited when a second target lands.
- **Field-level secrets, provisioning refs inside structured params** — excluded by
  ADR-0018/0019.

## Files in play

`packages/app/src/config.ts`, `index.ts`, `node.ts`;
`packages/app-cloud/src/compute.ts`, `serializer.ts`, `control.ts`, `http.ts`,
`postgres.ts`; `packages/app-rpc/src/rpc.ts` (+ maybe lift `standard-schema.ts`);
`packages/app/package.json` (add `@standard-schema/spec`). Tests alongside each.
