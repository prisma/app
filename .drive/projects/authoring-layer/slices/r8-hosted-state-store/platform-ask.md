# Platform ask — workspace-scoped Alchemy state API (Management API surface)

Draft for a Linear ticket (agent sessions have no Linear access — file manually
or via the Ignite gotcha/ask workflow). Target project: platform / Management
API.

## Ask 1 — workspace-scoped state API

Implement **Alchemy's HTTP state-store API** as a Management API surface,
workspace-scoped, authorized by service tokens / workspace RBAC.

The contract already exists and ships in the `alchemy` package:
`alchemy/State/HttpStateApi.ts` (`alchemy@2.0.0-beta.59`) — a versioned
HTTP API (`STATE_STORE_VERSION = 5`) with bearer-token auth middleware and a
`/version` probe. Endpoints cover exactly the 12-method `StateService`
interface: list stacks/stages, get/set/delete resource state by
`{stack, stage, fqn}`, delete stack/stage, list FQNs, get/set stack output,
and replaced-resource listing. Payloads are JSON; secret values arrive wrapped
in alchemy's `__redacted__` marker envelope.

## Why

MakerKit deploy state (the Alchemy state store — the source of truth for
"what's provisioned") should be hosted, workspace-scoped platform state:
Terraform-Cloud-style. Today MakerKit ships a client-side interim
(`@makerkit/prisma-alchemy/state`, slice R8): a `StateService` speaking
Postgres directly to a reserved `makerkit-state` project's default database in
the user's workspace, bootstrapped through the Management API, with
session-advisory-lock concurrency control. It works, but:

- auth is "holds a workspace service token" — no finer RBAC;
- the store is visible as a user project (`makerkit-state`) rather than
  ambient platform infrastructure;
- every client must embed the store implementation.

When the platform implements the StateApi:

- deployers switch to alchemy's stock `httpStateStore({ url, authToken })` —
  zero MakerKit code beyond handing it the Management API URL + token;
- the `makerkit-state` project disappears;
- the platform can answer "what's provisioned in this project" natively (the
  inspectable-topology goal's platform half), and server-side runs
  (git-push-style deploys) become incremental.

Design context: `docs/design/03-domain-model/layering.md` (the
provisioning-state spectrum — this is Step 1's final form, enabling Step 2).

## Requirements sketch

- Bearer auth: service tokens; scope state to the token's workspace.
- Storage: platform's choice (the interim proves Postgres tables keyed
  `(stack, stage, fqn)` + `(stack, stage)` for outputs are sufficient).
- Locking: the alchemy interface has none; the platform should provide
  per-`(stack, stage)` lease semantics (the interim uses session advisory
  locks). A `409`-on-concurrent-apply is acceptable v1.
- Version probe: `GET /version` → `5` (the store contract version the client
  was built against; alchemy's client checks it).
- Encryption at rest; values contain provisioning secrets today (see the
  MakerKit deferred item "provisioned credentials → transient platform
  secret" for the longer-term shape).

## Ask 2 — reserved/unique project names

Verified 2026-07-09: PDP allows duplicate project names — two projects in the
same workspace can both be named `makerkit-state`. The hosted state store
discovers its project by listing and filtering on this name (`bootstrap.ts`),
so without a way to reserve or enforce uniqueness, that discovery is
ambiguous (which of several same-named projects is ours?) and squattable
(anyone with workspace access can create a project named `makerkit-state`
before the real bootstrap ever runs, or after, occupying the name).

The current mitigation (`bootstrap.ts` `verifyOwnership`) is entirely
client-side: it connects to each same-named candidate's default database and
inspects its tables/marker row to decide ownership, in deterministic
`createdAt` order, and refuses to adopt anything that looks foreign. This
works, but it is strictly a workaround for a platform gap — a client can
never fully rule out a race between its own discovery query and another
actor's concurrent create.

Ask: either enforce unique project names per workspace (reject a create that
collides with an existing name), or provide a way to reserve/claim a name
atomically (e.g. a name-is-a-unique-key create-if-absent semantics, or a
dedicated "system project" concept outside normal user-created project
space). Either removes the need for `verifyOwnership`'s data-inspection
workaround entirely.
