# Config params

How a service's configuration is declared, typed, carried through deploy, stored on
a platform, and read back at boot. Rests on
[ADR-0018](../90-decisions/ADR-0018-config-params-carry-a-caller-owned-schema.md)
(params carry a caller-owned schema) and
[ADR-0019](../90-decisions/ADR-0019-the-target-owns-config-serialization.md) (the
target owns serialization, over key/value string pairs).

## The declaration

A param is a schema plus a few framework facets. The schema — a Standard Schema,
with arktype as the canonical author — is the caller's, and it does double duty:
TypeScript infers the value type from it, and it validates the value at boot.

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec';

export interface ConfigParam<S extends StandardSchemaV1 = StandardSchemaV1> {
  readonly schema: S;
  readonly default?: StandardSchemaV1.InferOutput<S>;
  readonly secret?: boolean;    // redaction + secure placement, a handling concern
  readonly optional?: boolean;
  serialize(value: StandardSchemaV1.InferOutput<S>): Record<string, string>;
  deserialize(pairs: Record<string, string>): StandardSchemaV1.InferOutput<S>;
}

export type Params = Record<string, ConfigParam>;
```

`Values<P>` maps a param set to the values an implementation receives, inferring
each through `InferOutput` and widening the optional ones. A service's `load()`
returns those values (merged with its hydrated deps).

Scalars stay terse behind helpers so the common case is a one-word declaration:

```ts
const string = (o?: Omit<Facets, 'schema'>) => ({ schema: type('string'), ...o, /* serializer */ });
// { url: string({ secret: true }) }
```

There is no `ParamType` enum and no curated set of permitted types. A new shape is a
new schema in user space, never a change to core.

## Two axes: type and serializer

A param carries both its **type** (the schema — the caller's) and its
**serializer** (`serialize`/`deserialize` — the target's). They are independent
concerns that meet on one object:

- The **schema** says what the value *is* and validates it. It is the same across
  every deployment of the param.
- The **serializer** says how the value becomes stored config and back. It belongs
  to whatever target stores it.

These don't conflict, because the param that reaches a Service node is the target's
param type by construction. A `compute()` service's params are Compute params
(`@prisma/app-cloud`'s), so their serializer is app-cloud's. The requirement floats
up the type tree: a utility that builds a param for a Compute service returns the
Compute param type, so user code passes the right thing without thinking about it,
and the compiler rejects a param typed for a different target.

The serializer's medium is fixed even though its format is not: it emits **key/value
string pairs** under the param's key namespace. A structured value may collapse to
one key holding an encoded blob, or fan out across several keys — the target's
choice. The *format* inside a value (JSON or anything else) is the target's private
business; core neither sees nor constrains it. What is fixed is that the medium
between serializer and platform is key/value strings, which is what an
environment-backed platform stores, one row per pair.

## The pipeline, end to end

Follow a structured value — a scheduler's `jobs`, a list of `{ jobId, every }` —
from the developer's keyboard to a running instance and back. The scalar params
(`port`, a dependency's `url`) travel the same path; the structured one just
exercises more of it.

**Author.** A utility returns the `jobs` param: its `schema` is the caller's job
shape, its `default` is the schedule, its serializer is the target's (because it
feeds a `compute()` service).

**Graph.** `prisma-app deploy` loads the root system. The scheduler node carries
`params.jobs` (schema + default) and its dependency inputs.

**buildConfig** (deploy) assembles the node's typed `Config`. A service's own params
come from their `default`; dependency-input params come from the producers' lowered
outputs (a resource's address, a sibling's URL). The structured `jobs` value rides
through as-is — `Config` values are `unknown`, so nothing flattens it:

```
Config = { service: { jobs: [ {jobId:'tick',every:'60s'}, … ], port: 3000 },
           inputs:  { trigger: { url: 'https://…' } } }
```

**serialize** (deploy, the target). The target's `ServiceLowering.serialize` walks
the `Config` and, per param, calls its `serialize` to get key/value string pairs,
under the `ADDRESS_OWNER_NAME` key namespace:

```
CRON_JOBS        = '[{"jobId":"tick","every":"60s"}, …]'
CRON_PORT        = '3000'
CRON_TRIGGER_URL = 'https://…'
```

**Store** (deploy, the platform). Each pair becomes one project-scoped, encrypted
environment variable via the platform API; the service's deployed version declares a
dependency on them, so it is ordered after the writes and re-versioned when any
value changes.

**deserialize + stash** (boot, the target). The instance's bootstrap reads the
stored pairs by key and, per param, calls `deserialize` to reverse them — the `jobs`
serializer parses and validates against the schema, rebuilding the typed `Job[]`;
scalars reverse to their types. That reconstructs the identical typed `Config`. The
values are then re-emitted under address-free keys so `load()` needs no address.

**load** (runtime). The service entry calls `load()` and receives `{ trigger, jobs,
port }` — deps hydrated into clients, params resolved to their typed values. The
structured value is back, validated, exactly as authored.

The round trip in one line:

```
value → param.default → Config.service.jobs (structured)
      → target.serialize → CRON_JOBS='…' → env var (encrypted)
      → target.deserialize → parse + validate → Job[] → load()
```

## Introspection

`configOf` enumerates a node's params into a declaration list without booting
anything. Because a param carries its schema, the declaration carries the schema (or
its JSON-Schema projection), so a structured param reports its real shape — not "a
string." Topology tooling and agents see what a service is configured with.

## Boundaries

- **Core never encodes.** It builds the typed `Config` from the graph and hands it
  to the target. It never stringifies and never reads an environment; even the
  medium (k/v strings) is the target's, not core's.
- **Structured params are static data.** A param's own value is its `default`; refs
  to other nodes arrive through dependency inputs. A schema param cannot embed a
  provisioning ref — a needed address is a dependency edge, not a param field.
- **`secret` is handling, not type.** It governs redaction in introspection and
  secure placement by the target, independent of the schema.

## Related

- [ADR-0018](../90-decisions/ADR-0018-config-params-carry-a-caller-owned-schema.md),
  [ADR-0019](../90-decisions/ADR-0019-the-target-owns-config-serialization.md) — the
  decisions this documents.
- [`core-model.md`](core-model.md) — where params sit in the node/graph/Config model.
- [`scheduled-work.md`](scheduled-work.md) — cron, the worked consumer of a
  structured param.
- [`connection-contracts.md`](connection-contracts.md) — the `Contract`/`rpc`
  caller-owned-type idiom params mirror.
