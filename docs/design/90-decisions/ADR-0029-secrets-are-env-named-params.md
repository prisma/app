# ADR-0029: Secrets are env-named params

## Status

Proposed

## Decision

A secret is an ordinary config param carrying the `secret` facet, bound to an
explicit platform environment-variable name. The framework only ever handles
that name — never the value:

```ts
compute({
  name: 'ingest',
  params: { stripeKey: envSecret('STRIPE_SECRET_KEY') },
  // ...
});
```

`envSecret(name)` is a core param constructor
([config.ts](../../../packages/0-framework/1-core/core/src/config.ts)):

```ts
export interface ConfigParam<S extends StandardSchemaV1 = StandardSchemaV1> {
  readonly schema: S;
  readonly secret?: boolean;
  readonly external?: string; // platform env-var name; provisioned out-of-band
  readonly optional?: boolean;
  readonly default?: StandardSchemaV1.InferOutput<S>;
}

export function envSecret(
  name: string,
  opts?: { readonly optional?: boolean },
): ConfigParam<StandardSchemaV1<string, string>>;
```

`envSecret(name)` returns `{ schema: <string schema>, secret: true, external:
name }`. `external` is a new facet on `ConfigParam`/`ConfigDeclaration`
carrying the platform name a secret is bound to — the user provisions the
matching value on the platform; the framework never does.

A leaf module binds its own secret param directly, as above. Forwarding an
*unbound* secret param up through an enclosing module for something else to
bind later is out of scope for this slice — it depends on hex-composition's
boundary-port seam, which S1 doesn't build. So a service-own param that is
`secret: true` but carries no `external` name fails loudly at deploy build:
"bind it with `envSecret` or wire it" — "wire it" meaning: make the value
arrive as an ordinary dependency input from a producer node whose own param
does carry the binding, the same way any other connection value already
flows.

`secret: true` **forbids `default`**, enforced at the type level (a param
options type that splits secret from non-secret) and at runtime
(`withFacets`/`freezeParams`). `optional` is still allowed on a secret param.

**Reserved names.** `external` must not start with the framework's own
`COMPOSE_` prefix (below) and must not be `DATABASE_URL` /
`DATABASE_URL_POOLED`, which Prisma Compose poisons at project provision.
Both are validated when the param is constructed.

The framework carries the name across three moves:

1. **Manifest introspection.** `configOf` reports each param's `external`
   name; the graph's aggregate of every secret declaration with an `external`
   name is the app's *provision manifest* — everything that must exist on the
   platform before deploy.
2. **Pointer serialization.** The pack
   ([serializer.ts](../../../packages/1-prisma-cloud/1-extensions/target/src/serializer.ts))
   writes a secret param's row as a pointer — the generated key maps to the
   `external` name, not a value:
   ```
   COMPOSE_INGEST_STRIPEKEY = "STRIPE_SECRET_KEY"
   ```
   Boot deserializes by reading the generated key to get the pointer, then
   reading `process.env[pointer]`. A secret's value never passes through the
   serializer's own encoding, is never written as a `ConfigVariable` row's
   value by the framework, and never enters Alchemy's deploy state.
3. **Deploy preflight.** Before Alchemy runs, the pipeline verifies every
   manifest name exists on the platform for the target stage's resolved
   class/branch. A name missing from the platform but present in the deploy
   shell's own environment is filled in directly; anything still missing
   fails the deploy, listing exactly what's absent.

## Reasoning

### The platform already treats env-var values as write-only

Per [pdp-data-model.md](../05-prisma-cloud/pdp-data-model.md),
`ConfigVariable` values are encrypted under the project's key and are never
returned by a read — the Management API only ever accepts a value
(`POST`/`PATCH`); it never returns one. Every compute version snapshots the
**entire branch env map** at version-create time
(`materializeBranchEnvVars`), so a variable a user provisions directly on the
platform is already visible to every service attached to that branch — no
framework machinery is needed to get a value from "provisioned" to "running
instance." Rotation is just the platform's existing semantics: `PATCH` the
value, then create a new version, since a version's env is frozen at creation
and there is no live re-resolution. This design adds no new security
primitive — it routes *names* so a booting service knows which platform
variable holds its value.

### Why a name, not a value, crosses into the framework

If the framework carried a secret's value at all — through `buildConfig`,
into a generated stack file, into Alchemy's deploy state — it would sit
somewhere designed to be inspected, diffed, or read back
(a stack file is generated to be inspectable by design, per
[ADR-0007](ADR-0007-deploy-drives-alchemy-through-a-generated-stack-file.md)).
None of that machinery was built to hold a secret safely, and adding that
would mean every future exporter or lowering pass has to remember not to leak
the field. Keeping the framework's job to *names* sidesteps the problem
instead of defending against it: a name is exactly as safe to write, log, and
diff as any other config value, because a name is not the secret.

This is also the constraint a future secrets-manager integration needs
already satisfied: the endgame is the platform pulling a value from a
customer's secrets manager at version materialization, with the value never
touching the deploy machine. A framework that has only ever carried names has
nothing to change when that lands.

### Pointer rows and the `COMPOSE_` prefix

A secret param's stored row is a pointer: the generated key (e.g.
`INGEST_STRIPEKEY`) maps to the platform name (`STRIPE_SECRET_KEY`), not a
value. Boot double-looks-up: read the generated key to get the pointer, then
read `process.env[pointer]`.

Every generated key now carries a `COMPOSE_` prefix
(`COMPOSE_INGEST_STRIPEKEY`), fixing a real latent bug: the
`EnvironmentVariable` reconciler adopts and `PATCH`es whatever row already
exists at the same `(project, class, key)`
([EnvironmentVariable.ts](../../../packages/1-prisma-cloud/0-lowering/lowering/src/compute/EnvironmentVariable.ts)),
so a generated key that happened to collide with a user's own secret name
would silently overwrite it. The prefix reserves a namespace for everything
the framework writes, leaving the user's namespace (`STRIPE_SECRET_KEY`,
`SENDGRID_API_KEY`, …) untouched. Adoption is further restricted: the
reconciler may only adopt a match when its own prior state row exists or the
key is a poison key (`DATABASE_URL`/`DATABASE_URL_POOLED`); adopting a
`COMPOSE_`-prefixed row it did not itself create fails loudly instead of
silently taking it over.

### Preflight: verify before Alchemy runs, fill from the shell when possible

Every compute version snapshots the branch's env map at creation, so a
secret's platform variable has to exist *before* that service's version is
created — the same timing constraint every `ConfigVariable` is already under
(pdp-data-model.md). Preflight makes that constraint explicit instead of
surfacing as a runtime failure inside an already-deployed instance: before
Alchemy runs, the deploy pipeline aggregates the manifest (every secret
declaration with an `external` name), resolves the check scope from the
target stage
([ADR-0024](ADR-0024-a-stage-is-a-deploy-time-environment-resolved-to-project-and-branch.md)) —
the default stage checks production-class project templates; a named stage
checks preview-class templates merged with that branch's overrides, the
platform's own materialization order — and calls `GET
/v1/environment-variables` (metadata only) to verify each name exists.

A name absent from the platform but present in the deploy shell's own
environment (`process.env[externalName]`) is filled in during preflight: a
**direct management-API `POST`, never an Alchemy resource** — resource props
persist in hosted deploy state, and a secret's value must not. The value
transits CLI process memory exactly once and is never logged. Fill-missing
never overwrites an existing platform value, so a rotation made on the
platform always wins over a stale shell value. This is what makes a first
deploy single-step in CI: a CI secret lands in the runner's environment, and
the CLI provisions it onto the platform on the way to deploying.

A name absent from both the platform and the shell fails the deploy, listing
every missing name with its class/branch scope and directing the user to set
it in the shell or on the platform.

### `secret` forbids `default`

A `default` on a secret param would let preflight pass while the real secret
is still missing — a service would boot on the fallback value instead of
failing — and it would put that fallback value into the graph's introspection
output, exactly what `secret` exists to keep out. `optional` carries no such
risk: an optional secret's absence is a legitimate outcome, validated the same
way any other optional param's absence is.

## Consequences

- **The framework never handles a secret's value** — not in `buildConfig`,
  not in the generated stack file, not in Alchemy deploy state, not in any
  log. Everything the framework touches is a name.
- **A first deploy in CI is single-step**: shell env → fill-missing → deploy,
  with no separate provisioning command.
- **Rotation has no framework-specific procedure.** `PATCH` the platform
  value and redeploy — the platform's existing version-snapshot semantics,
  not something this design adds.
- **The same key works across stages without renaming.** Class/branch
  materialization already gives `STRIPE_SECRET_KEY` a different value in
  preview than in production; the pointer row is stage-neutral.
- **The `COMPOSE_` prefix renames every existing generated key.** An
  existing app's first redeploy under this design rewrites every config row
  and creates a new version for every service — a one-time churn the
  no-op-redeploy E2E check needs to re-baseline against.
- **Leaf→root secret forwarding across nested modules is not built.** A
  service-own secret param with no `external` name fails at deploy build
  instead of silently having no value; extending forwarding to nested modules
  is deferred to whatever work builds hex-composition's boundary ports.
- **A future secrets-manager integration slots in without a framework
  change**: the platform pulling values from a customer's secrets manager at
  version materialization needs exactly the "framework carries only names"
  constraint this design already establishes.

## Alternatives considered

- **Derive the platform name from the param key.** Rejected: a naive
  uppercase of `stripeKey` gives `STRIPEKEY`, which never matches a real
  platform variable like `STRIPE_SECRET_KEY`; a camelCase→SCREAMING_SNAKE
  transform is magic, and ambiguous the moment a key has digits or an
  acronym in it. An explicit name removes the guessing.
- **Value-as-default sourced from the deployer's environment** — the
  `fromEnv()` stopgap on branch `claude/datahub-port`. That branch bridged
  secret values as an app-side convention: a value read from the deployer's
  own environment became the param's `default`, and the serializer wrote that
  default into an `EnvironmentVariable`'s *value* — landing a secret's actual
  value in Alchemy deploy state, with no deploy-time check that the value was
  even present. That branch's own plan flagged this as needing "a
  first-class values mechanism … the durable fix"; this ADR is that
  mechanism. Rejected as the durable design because it persists a secret's
  value where deploy state is inspected, and because `secret: true`
  forbidding `default` makes the pattern unexpressible going forward.
- **Bake wiring into the bundle to avoid a pointer row** — resolve a secret's
  platform name at build time and inline it into the compiled bundle instead
  of writing it as a config row. Rejected: it makes the bundle stage-specific.
  The same artifact could no longer deploy unchanged to preview and
  production — which the platform's own class/branch materialization exists to
  let it do, and which target-owned serialization keeps stage-neutral
  ([ADR-0019](ADR-0019-the-target-owns-config-serialization.md)). A pointer
  row, resolved by the target at deploy, keeps the built artifact identical
  across stages.
- **Unprefixed generated keys.** Rejected: the `EnvironmentVariable`
  reconciler adopts and `PATCH`es any pre-existing row at the same
  `(project, class, key)`
  ([EnvironmentVariable.ts](../../../packages/1-prisma-cloud/0-lowering/lowering/src/compute/EnvironmentVariable.ts)),
  so an unprefixed generated key colliding with a user's own secret name
  would be silently overwritten by the framework's own provisioning.

## Related

- [ADR-0018](ADR-0018-config-params-carry-a-caller-owned-schema.md) — a param
  carries a caller-owned schema plus facets; `secret` and `external` are two
  more facets on that same plain object.
- [ADR-0019](ADR-0019-the-target-owns-config-serialization.md) — the target
  owns serialization; the pointer row and double-lookup are
  `@prisma/compose-prisma-cloud`'s serialization choice, not core's.
- [ADR-0024](ADR-0024-a-stage-is-a-deploy-time-environment-resolved-to-project-and-branch.md) —
  preflight's class/branch scope resolution rides the same stage → Project/Branch
  resolution this ADR builds on.
- [`config-params.md`](../10-domains/config-params.md) — the params model end
  to end; § Secrets is this ADR's summary in that document's voice.
