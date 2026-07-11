# ADR-0019: The target owns config serialization; params serialize to key/value string pairs

## Status

Proposed

## Decision

Serializing a config param's value into stored config, and reading it back, is the
**deploy target's** responsibility — not core's and not a universal format. The
serializer is carried by the param, but the param that feeds a target's Service
node is *that target's* param type, so its serializer is the target's. The one
thing fixed across targets is the intermediate medium: a param serializes to
**key/value string pairs**. How a value becomes those strings is the target's
private business; core neither sees nor constrains it.

## Reasoning

Config has to travel from deploy time onto a running instance and back. On Prisma
Cloud that path is concrete: each param value becomes a project-scoped, encrypted
`EnvironmentVariable` (`POST /v1/environment-variables`), keyed
`ADDRESS_OWNER_NAME`, which Compute injects into the service; at boot the service
reads it back. The environment is a set of `{ key, value: string }` rows — nothing
else.

So *something* turns a value into strings and back. The question is only whose code
does it, and the answer follows from who stores it. The value lands in the target's
storage, so the target dictates how it's encoded and where it goes. This is already
how the model is built: `@prisma/app-cloud` owns a serializer shared by its
deploy-side `serialize` and its boot-side `deserialize`, so writer and reader can't
drift.

The subtlety is that a param can be *declared* by a package that isn't the target —
a scheduler's `jobs` param is declared by a scheduling extension but stored by
Prisma Cloud. There is no conflict, because the param that reaches a Service node is
the target's param type by construction. A scheduler is a `compute()` service;
`compute()` is `@prisma/app-cloud`'s; so its `jobs` param is a Compute param, and a
Compute param carries app-cloud's serializer. The requirement floats up the type
tree: the utilities a user calls to build the schedule return the Compute param
type, so the user's code passes the right thing without knowing it. Change the
target and the param type changes with it; the serializer travels along. There is
never a free-floating "generic param" a target has to adopt.

The serializer's shape is a set of key/value string pairs under the param's key
namespace, not a single string:

```ts
serialize(value)   → Record<string, string>
deserialize(pairs) → value
```

This gives a structured param latitude — a schedule can be one key holding an
encoded blob, or fan out across several keys — while the medium stays uniformly
string k/v, which is exactly what the environment stores, one row per pair. The
*final string form* inside a value doesn't matter to the framework; the target's
own `deserialize` reverses whatever its `serialize` wrote. What matters is that the
medium between serializer and platform is key/value strings.

For this to carry a schema-typed value ([ADR-0018](ADR-0018-config-params-carry-a-caller-owned-schema.md)),
two concrete things change. `compute()` must accept a `params` field at all — today
it hardcodes a single `port` param and gives callers no way to add more. And
app-cloud's serializer must replace its scalar `String()`/coerce-by-enum path with
the param's own `serialize`/`deserialize`, so it stops assuming one declaration is
one string-coerced key.

## Consequences

- **A new platform is a new serializer, not a param change.** A future Compute that
  accepts structured JSON config supplies its own param type whose serializer emits
  its native shape. Consuming code — the `jobs` declaration, the service — does not
  move.
- **`compute()` opens to user params**, typed as Compute params. Its reserved
  `port` merges with them; a user param colliding with a reserved name fails at
  authoring, as `port` already does with deps.
- **Core stays out of encoding entirely.** It builds the typed `Config` from the
  graph and hands it to the target; it never stringifies and never reads an
  environment. That boundary, already stated in the config model, is preserved and
  extended: even the medium (k/v strings) is the target's, not core's.
- **The param and the target must agree on the medium.** A serializer that emits
  something other than string k/v pairs can't be stored by an env-backed target.
  That is the deliberate contract, not an accident to paper over.

## Alternatives considered

- **Core serializes to a universal portable representation (JSON), target does
  physical placement.** A fixed framework-level intermediate. Rejected: it makes the
  framework see and constrain a representation it has no business knowing, and it
  forces every target through JSON even when its storage is richer. The target
  should own the whole value→storage path.
- **Serializer keyed by (param, target) in a target registry, param declares only
  schema.** Coherent, but it makes the target enumerate or generically handle every
  param kind it might store. Letting the param type *be* the target's — because the
  Service node is the target's — gets the same "target owns it" outcome with the
  type system doing the enforcement, no registry.
- **Param serializes to a single string.** Rejected as too narrow: it forecloses a
  param fanning out across keys, and it conflates "the medium is strings" with "the
  value is one string." The medium is key/value *pairs*.

## Related

- [`ADR-0018`](ADR-0018-config-params-carry-a-caller-owned-schema.md) — the
  schema-typed param whose value this serializes.
- [`ADR-0017`](ADR-0017-control-plane-loads-through-the-app-config.md) — the
  target/extension control plane that owns serialization.
- [`config-params.md`](../10-domains/config-params.md) — the end-to-end
  serialization pipeline, from user code to platform storage and back.
