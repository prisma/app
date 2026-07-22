# Local dev (`prisma-composer dev`)

The local dev loop: one command brings up the whole topology from the root
module, credential-free, with deploy parity everywhere above the Alchemy
provider boundary. The architectural decision — dev runs the deploy pipeline
against local providers, substituted through an extension's `dev` descriptor —
is recorded in
[ADR-0041](../90-decisions/ADR-0041-local-dev-runs-the-deploy-pipeline-against-local-providers.md);
this doc is the mechanics.

## Scope

One command:

- **`prisma-composer dev <entry>`** — bring up the application whose root node
  is `entry`'s default export, entirely on the local machine, and keep it up:
  watch built output, restart changed services, stream logs, until interrupted.

Flags: `--fresh` (destroy the dev stack and wipe the dev state directory before
starting). Nothing else to start with. Stages do not apply — a working
directory has exactly one dev instance; parallel instances are parallel
checkouts.

**Naming.** goals.md calls the local emulator "`prisma dev`". That name is
owned today by the ORM CLI's local-Postgres command — which this harness itself
shells out to. The command is therefore `prisma-composer dev`; convergence on a
shorter name is a CLI-distribution question (Composer joining a unified
`prisma` CLI), not a design question here.

## The pipeline, relative to deploy

Dev re-runs [deploy's pipeline](deploy-cli.md#the-pipeline) with these deltas:

1. **Import + Load** — identical, same errors.
2. **Config** — identical, except: every extension in the config must carry a
   `dev` descriptor; a missing one fails naming the extension ("`<id>` has no
   dev support"). The extension factory must resolve **no** platform
   environment on this path (no workspace id, no region, no token).
3. **Assemble** — identical. Dev consumes the user's built output through the
   same adapters and produces the same bundles; missing output produces the
   same "run your build" error.
4. **Containers** — the `dev.container` descriptor resolves a stable local
   identity from the app name with no platform calls. Long-running stand-ins
   the converge cannot own (the bucket server) start next, through the
   extension's `dev.standIns` hook.
5. **Lower + converge** — a dev-generated stack file (ADR-0007's pattern, at
   `.prisma-composer/dev/alchemy.run.ts`), driven with the extension's
   `dev.providers()` layer and Alchemy's built-in `localState()` store, always
   at Alchemy stage `dev`. Converge terminates as always; services are *not*
   running when it exits — desired state is.
6. **Supervise** — new, dev-only: reconcile the process table (below), print
   the front door, stream logs, watch for rebuilds, loop.

## The process table

The seam between converge (terminating) and serving (long-running). The local
`Deployment` provider's `reconcile` does not spawn; it writes one record per
service into the dev state directory:

```jsonc
// .prisma-composer/dev/processes/<address>.json
{
  "address": "chat",
  "artifactHash": "sha256-…",
  "artifactDir": "…/dev/artifacts/sha256-…/", // unpacked once per hash
  "env": { "COMPOSER_CHAT_DB_URL": "…", "PORT": "3000", … },
  "port": 3000
}
```

The `dev` command reconciles the table against reality:

- **Record with no process** → spawn the artifact's bootstrap as a child, env
  from the record, stdout/stderr multiplexed into the dev log stream prefixed
  by address.
- **Record's `artifactHash` changed** → kill the child, respawn from the new
  artifact dir. Only the changed service restarts — Alchemy's diff already
  guaranteed only its record changed.
- **Child exits unexpectedly** → log loudly with the exit code, restart with
  backoff; repeated crash-looping surfaces as a standing error line, not silent
  churn.
- **Record deleted** (a service removed from the topology, `--fresh`) → kill
  the child.
- **Ctrl-C** → kill every child and stop the bucket server; the local Postgres
  instances stay up (they run detached, hold the data, and make the next start
  warm). `--fresh` is what stops and removes them.

The env materialization in each record is the one platform-side behavior the
local target implements itself: the hosted platform joins the branch's config
variables into a deployment at version-create; locally, the `Deployment`
provider performs the same join from the `EnvironmentVariable` records the
lowering emitted — against props defined in this repo, once, not an emulation
of a foreign API.

## Resource substitution

The full inventory (see
[alchemy-lowering.md](../05-prisma-cloud/alchemy-lowering.md) for the hosted
semantics):

| Resource | Dev behavior |
| --- | --- |
| `Project` | a local identity record; no platform |
| `Database` | a database on the local Postgres server (ORM `prisma dev`) |
| `Connection` | the local connection URL |
| `ComputeService` | allocates a port (persisted in state, stable across runs); `endpointDomain = http://localhost:<port>` — which makes origin (ADR-0039) work unchanged |
| `Deployment` | unpacks the artifact once per hash; writes the process-table record |
| `EnvironmentVariable` | a key→value row in the dev state store |
| `Bucket` | a directory under `.prisma-composer/dev/buckets/<bucket>/`, served by the local S3 server |
| `BucketKey` | accepted credentials on the local S3 server |
| `ServiceKey` | **unchanged** — mints locally, persists in state |
| `S3Credentials` | **unchanged** — mints locally, persists in state |
| `PgWarm` | **unchanged** — real `select 1` against the local URL |
| `PnMigration` | **unchanged** — real migrations against the local URL |

Because module-backed kinds (storage, streams, email) lower to compute services
plus databases, they run their **real service code** locally against local
Postgres — no per-module stand-in, maximum fidelity. The streams module's
SQLite test stand-in remains a testing utility, not part of the dev loop.

### Postgres

The stand-in is the ORM CLI's local Postgres (`prisma dev`), **one named,
detached instance per `Database` resource** — instance names are derived from
the app and database ids, so instances are isolated, discoverable
(`prisma dev ls`), and survive across dev restarts for warm starts.
Migrations are not special-cased: `PnMigration` runs exactly as it does in a
deploy, against the local URL. `PgWarm` is near-instant locally and is kept
(not stubbed) so the provider set stays uniform.

### Buckets: a disk-backed S3 server

The storage module already implements the S3 wire protocol over an
`ObjectStore` interface with full SigV4 verification, including presigned URLs
([storage/src/handler.ts](../../../packages/1-prisma-cloud/2-shared-modules/storage/src/handler.ts),
[storage/src/sigv4.ts](../../../packages/1-prisma-cloud/2-shared-modules/storage/src/sigv4.ts)),
with memory- and Postgres-backed stores. The domain layering
(lowering < extensions < modules, upward imports denied) means dev machinery
cannot import the storage module, so the protocol pieces (handler, SigV4,
`ObjectStore`, memory store) move down into a shared protocol package at the
lowering layer that both the module and the dev stand-in import — a
behavior-preserving extraction; the storage module's public surface is
unchanged. The dev bucket stand-in is then a third store implementation plus
one shared local server (plain `node:http`, which runs under both node and
bun, started through `dev.standIns` because it must outlive each converge):

- **Objects are plain files at their key paths** —
  `.prisma-composer/dev/buckets/<bucket>/<key>`. Browse them, open them, drop a
  file in and it exists in the bucket. This is a feature, not an
  implementation detail: inspectable state is half the value of local dev.
- Object metadata (content type, user metadata) lives in a sidecar tree, so
  the object tree stays clean for humans.
- One server per dev instance serves every bucket (the wire namespaces by path
  bucket, as the handler already does), accepting each minted `S3Credentials`
  pair.
- Multipart upload is initially unimplemented and fails with a clear error
  naming the limitation; add it when a real consumer needs it.

## Value sourcing

The same table the port's hand-rolled script implemented, now standard:

| Slot | Dev source |
| --- | --- |
| dependency connection values (URLs) | the local provider's resolved value, through the normal lowering |
| service params | bound literals / defaults, identical to deploy |
| `envParam` sources (ADR-0032) | the dev shell's environment, same names; missing → a hard error listing the names (params feed boot-time schema validation — junk there is a confusing crash, not a legible degraded mode) |
| secrets (ADR-0029) | shell env if set; else a minted placeholder (persisted, stable across restarts) + one printed warning per slot |
| minted needs (ADR-0030/0031: service keys, streams keys) | minted locally by the unchanged provisioners |
| origin (ADR-0039) | `http://localhost:<port>` via the unchanged origin channel |

The placeholder policy means a topology with a genuine external credential
(an LLM API key, say) boots and serves everything that doesn't touch that
credential; the paths that do touch it fail at the external service with the
placeholder — exactly the degraded-but-running behavior local dev wants, with
the warning naming the variable to export for full function.

## Scheduled work

Per ADR-0020 the scheduler is an ordinary service, so in dev it runs and its
schedules **fire for real** — a cron edge is exercised end-to-end without
ceremony. For determinism-sensitive sessions (agents asserting on side
effects), the scheduler service's trigger endpoint is reachable like any other
local service, so a manual `curl` fires any job on demand; a `dev`-surface
convenience for this (list jobs / trigger by id) is a nice-to-have, not v1.

## Error surface

Deploy's rule holds: every failure names its fix.

| Failure | Error tells the user |
| --- | --- |
| extension has no `dev` descriptor | which extension, and that it does not support local dev |
| built output missing | same as deploy: the expected path, "run your build" |
| `bun` not on PATH | that dev runs services under bun (the Compute runtime) and how to install it |
| no installed `prisma` bin (the local-Postgres stand-in) | what was searched for and to add `prisma` to devDependencies |
| ORM `prisma dev` fails to start | the exact command that was attempted and its output |
| port conflict on a persisted allocation | which service, which port, and how to free or re-allocate (`--fresh`) |
| secret slot unbound | warning (not an error) naming the env var and the placeholder behavior |
| env-sourced param unbound | hard error listing the missing names, deploy-preflight style |
| service crash-loops | the address, exit code, and the last stderr lines, as a standing message |

## Out of scope (designed around)

- **Hot reload / user-supplied dev commands.** The loop's unit of change is a
  rebuilt artifact. The designed extension (not v1): a service may opt into a
  dev command (e.g. `next dev`) that replaces its artifact process; the harness
  still resolves bindings and materializes the same env, and writes the stash
  so `load()`/`config()`/`secrets()` work without `run()`. The opt-in must be
  explicit precisely because it trades away artifact parity.
- **Remote bindings** (a local service against real cloud resources,
  Wrangler-style). A possible future opt-in; contradicts credential-free dev
  as a default.
- **Deploy verification integration** — `verify` runs against a dev instance
  the same way it runs against a deploy (the health surface is just another
  local endpoint); its design is its own lane.

## Open questions

- **Restart latency budget.** Assemble + package + converge per edit is
  unmeasured. The artifact cache (unpack once per hash) is designed; whether
  package's tar step needs a dev bypass for very large trees (Next standalone)
  is a measurement away. Decide with numbers, not in advance.

(Settled since the first draft: Postgres runs one named `prisma dev` instance
per `Database` resource; the front door prints every service URL ordered by
address depth then name, shallowest first; port allocation and the remaining
mechanics are pinned in the implementation spec.)

## Related

- [ADR-0041](../90-decisions/ADR-0041-local-dev-runs-the-deploy-pipeline-against-local-providers.md)
  — the decision this doc details.
- [deploy-cli.md](deploy-cli.md) — the pipeline dev re-runs and the error-surface
  convention it extends.
- [alchemy-lowering.md](../05-prisma-cloud/alchemy-lowering.md) — the resource
  inventory and lowering graphs the local providers implement.
- [core-model.md](core-model.md) — `run()`/`load()` and the stash protocol the
  spawned services boot through.
- [goals.md](../00-purpose/goals.md) — the local-dev-emulator goal.
