# Project: local dev (`prisma-composer dev`) — implementation spec

> Status: settled design (ADR-0041 + `docs/design/10-domains/local-dev.md`,
> design sessions with Will, 2026-07-22). This spec is exhaustive by intent:
> every name, type, behavior, and file placement is pinned. An implementer who
> finds a genuine gap records it here and asks — they do not improvise.
> Where this spec and the design docs disagree, this spec is a bug in one of
> them: stop and reconcile, don't pick silently.

## At a glance

`prisma-composer dev <entry>` brings up the whole application locally,
credential-free: it re-runs the deploy pipeline (Load → assemble → lower →
Alchemy converge) against local providers declared on the extension's new
`dev` descriptor field. The target runs one machine-scoped, multi-tenant
**emulator per node kind** — a Compute emulator (runs service processes from
their real packaged artifacts), the Postgres emulator (ORM `prisma dev`),
and a bucket emulator (S3 wire over disk). Providers provision isolated
instances by talking to the emulators during converge; the dev command is a
view (`attach`): endpoints, merged logs, watch-rebuild-reconverge, Ctrl-C
stops the app's services while emulators and data persist. The lowering
(`nodes`/`provisions`) is byte-identical to deploy; parity holds by
construction above the Alchemy provider boundary.

## Settled decisions (do not relitigate)

| # | Decision | Where recorded |
|---|---|---|
| D1 | Dev = the deploy pipeline retargeted at the Alchemy **provider** boundary; never an HTTP Management-API emulation, never a bespoke per-kind dev harness | ADR-0041 |
| D2 | The seam is `ExtensionDescriptor.dev?: DevDescriptor` — `providers`, `container`, `preflight`, `emulators`, `attach`, `teardown`; **no `nodes`, no `provisions`, no `state`** | ADR-0041 |
| D3 | Dev Alchemy state = alchemy's own `localState()` via the existing `LowerOptions.state` override, always at Alchemy stage `dev` | ADR-0041 |
| D4 | One machine-scoped, multi-tenant emulator **per node kind**, ensured by the topology-aware `dev.emulators` hook; providers provision isolated instances by communicating with them; converge terminates and the Compute emulator keeps serving | ADR-0041 |
| D5 | The dev command owns no processes: it is a view through `dev.attach` (endpoints, merged logs, stop control). Ctrl-C stops the app's service instances; emulators + data persist; `--fresh` removes; detached mode is a designed extension, not v1 | ADR-0041, local-dev.md |
| D6 | Bucket emulator = the storage module's S3 protocol handler + SigV4 over a new disk `ObjectStore`, one machine-global daemon, physical bucket names `<app>--<name>` carried on the binding, per-bucket in-project data roots; protocol pieces extracted DOWN to a lowering-layer package. Postgres = ORM `prisma dev`, one named detached instance per `Database` resource | ADR-0041, local-dev.md |
| D7 | Secrets: shell env else minted persisted placeholder + warning. Env-sourced params: shell env else **hard error** | ADR-0041 |
| D8 | The Compute emulator spawns children under **bun** (Compute's runtime) from the real packaged artifact's `bootstrap.js` — the deployed boot path, no bypass | ADR-0041 |
| D9 | Rebuilds are the user's (ADR-0005); dev watches **built output** and re-runs assemble + converge | ADR-0041 |
| D10 | Cron fires for real (ADR-0020); no dev-side special-casing in v1 | ADR-0041 |
| D11 | Hot reload / user dev-commands / remote bindings: designed extensions, **not v1** | local-dev.md |
| D12 | One dev instance per working directory; no stages; `--fresh` is wholesale local deletion, never `alchemy destroy` | local-dev.md |

## New/changed surface, by package

### 1. `@internal/s3-protocol` — NEW package (extraction)

Location: `packages/1-prisma-cloud/0-lowering/s3-protocol/` (beside
`lowering/`). Workspace name `@internal/s3-protocol`, private, `type: module`,
same `package.json`/tsdown shape as `@internal/lowering`. Declared in
`architecture.config.json` as `domain: prisma-cloud, layer: lowering,
plane: shared` (importable by extensions control code AND module execution
code — verify `pnpm lint:deps` accepts both import directions before building
on it; if the plane matrix rejects it, STOP — that is a design conflict to
reconcile, not to work around).

Files **moved verbatim** (git mv; adjust imports only) from
`packages/1-prisma-cloud/2-shared-modules/storage/src/`:

- `store.ts` — the `ObjectStore` interface + result types, unchanged.
- `sigv4.ts` — SigV4 verification, unchanged.
- `handler.ts` — the S3 wire handler (`createS3Handler`), unchanged.
- `memory-store.ts` — unchanged.

New files:

- `fs-store.ts` — `export function fsStore(resolveBucketDir: (bucket:
  string) => string | undefined): ObjectStore`. The resolver maps a (wire)
  bucket name to its directory — `undefined` = unknown bucket. An invalid
  bucket name (failing `/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/`) is treated
  identically to an unregistered one. On an unknown bucket,
  `get`/`head`/`list`/`delete` degrade to the missing-key shapes (null /
  empty list / no-op), which path-style addressing renders through the
  handler as 404 / empty-200 / 204; a `put` has no graceful shape (nowhere
  to write the bytes), so it throws — `handler.ts` does not catch store
  exceptions, so the hosting server surfaces a 500, and the thrown message
  names only the client-supplied bucket, never a server directory. The
  bucket emulator supplies the resolver from its registrations; a test can
  pin a fixed map. Mapping:
  - Object bytes: `<bucketDir>/<key>` — the key's `/` segments become
    directories. Writes are write-temp-then-rename
    (`<bucketDir>/.tmp/<uuid>` → target) so a concurrent read never sees a
    partial object.
  - Metadata sidecar: `<bucketDir>/.meta/<key>.json` containing
    `{ "contentType": string, "etag": string }`. `etag` = quoted SHA-256 hex
    of the object bytes (the store owns the ETag — store.ts's contract).
  - Key validation: an invalid key — one whose normalized path would escape
    the bucket dir (`..` segments, absolute paths, empty segments) or with
    a segment equal to `.meta` or `.tmp` — throws on every operation that
    takes one, when the bucket is known (on an unknown bucket the
    unknown-bucket shape above short-circuits first). The STORE — not the
    handler — is the escape protection: no bytes ever land outside the
    bucket dir. The throw surfaces as the host's 500 (no handler
    try/catch), and the message names only the client-supplied key, never
    the server directory.
  - A file present on disk without a sidecar (a developer dropped it in) is a
    valid object: `contentType` = `application/octet-stream`, etag computed
    on read and the sidecar written lazily. This is deliberate — droppable
    buckets are the feature.
  - `list`: lexicographic key order (walk + sort), `maxKeys` default 1000,
    `continuationToken` = the last returned key (opaque to callers), skip
    `.meta`/`.tmp`.
  - `delete`: remove object + sidecar, prune now-empty parent dirs up to the
    bucket dir; missing key is a no-op.
- `mintKeyPair` moves here (into `sigv4.ts`) from the target extension's
  `s3-credentials-resource.ts`; the extension re-exports it so both use one
  implementation.

This package stays **pure protocol** — no server, no daemon; those live in
`@internal/dev-emulators` (§ 2). The storage module needs none of the daemon
machinery.

Storage module keeps `pg-store.ts`, `storage-server.ts`, `handlers` etc. and
imports the moved pieces from `@internal/s3-protocol`. Its public exports
(`@prisma/composer-prisma-cloud/storage`, `/storage/testing`) are
byte-compatible — no consumer-visible change; existing storage tests must
pass unmodified (except import paths inside the package itself).

### 2. `@internal/dev-emulators` — NEW package (the emulator daemons)

Location: `packages/1-prisma-cloud/0-lowering/dev-emulators/`, name
`@internal/dev-emulators`, private, `type: module`, tsdown like
`@internal/lowering`. `architecture.config.json`: `domain: prisma-cloud,
layer: lowering, plane: control`. Imports `@internal/s3-protocol`; node
built-ins only. Two machine-global singleton daemons (`compute`, `buckets`)
plus the shared daemon layer and typed loopback clients.

#### `daemon.ts` — the shared daemon layer

- Registry: `<registryRoot>/<name>.json` —
  `{ "pid": number, "port": number, "version": string, "logPath": string }`.
  `registryRoot` defaults to `path.join(os.homedir(), '.prisma-composer',
  'emulators')`; `ensureDaemon`/`stopDaemon` accept an optional
  `{ registryRoot }` override whose ONLY caller is tests (isolation — a test
  never touches the real home directory). Production code never passes it.
- `ensureDaemon(name: 'compute' | 'buckets'): Promise<{ url: string }>`:
  1. Entry resolution: `fileURLToPath(import.meta.resolve(
     '@internal/dev-emulators/<name>-main'))`. Health path per daemon:
     compute `/health`, buckets `/_pcdev/health` (the bucket daemon's root
     namespace is the S3 wire). "Version" everywhere in this package means
     `@internal/dev-emulators`'s own `package.json` version, read at build
     time.
  2. Registry entry present AND pid alive AND health-path GET OK AND health
     `version` === this package's version → return `http://127.0.0.1:<port>`.
  3. Version mismatch → SIGTERM (5 s grace, SIGKILL), fall through. Dead
     pid / failed health → clean the entry, fall through.
  4. Start: port = persisted port if any, else smallest ≥ 4300 unused across
     registry entries, persisted immediately. Spawn `process.execPath
     <entry> --port <n> --state-dir <registryRoot>/<name>/` with
     `detached: true`, stdio appended to `<registryRoot>/<name>.log`,
     `unref()` — the `registryRoot` override governs the registry file, the
     state dir, AND the log path together, so an overriding test touches
     nothing outside its own root. Poll the health path, 10 s budget;
     timeout → kill the spawned child (it must not outlive a failed
     ensure), then
     `Error: <name> emulator failed to start on port <port> — see <logPath>.`
  5. Port taken at spawn (the daemon exits with a bind error before
     reporting healthy): if the registry entry is being created FRESH — no
     previously persisted port — the ensure, still holding the lock,
     allocates the next free candidate (≥ 4300, skipping registry-used
     ports), persists it, and retries the spawn, up to 5 candidates before
     the pinned failure error. A fresh allocation has handed out no
     endpoint, so moving it is safe — and this also makes ensure robust
     when isolated registries (tests) or foreign processes race for the
     same port. With a PREVIOUSLY persisted port, never retry elsewhere:
     endpoints frozen in deploy state reference it — fail with the pinned
     error; recovery is manual (`--fresh` does NOT touch the daemons — they
     are machine-global, shared by other apps).
- **Concurrent-ensure protocol:** the observe→spawn→persist critical
  section is serialized ACROSS PROCESSES per daemon name with an atomic
  directory lock: `mkdir <registryRoot>/.lock-<name>` (atomic creation IS
  acquisition; the holder writes its pid to `<lockDir>/pid`). On `EEXIST`:
  if the recorded holder pid is dead, remove the lock dir and retry
  immediately; else poll every 250 ms up to 10 s, then
  `Error: timed out waiting for another process ensuring the <name> emulator — remove <lockDir> if stale.`
  After acquiring, RE-READ the registry before deciding to spawn — the
  previous holder may have already done the job. Port allocation happens
  inside the lock, so two daemons can never claim one port. Release
  (rm the dir) in a finally.
- `stopDaemon(name)`: SIGTERM/SIGKILL + registry cleanup. Not called by any
  v1 command — an operator escape hatch, exported for tests.
- **Publish note (S5 scope):** `import.meta.resolve('@internal/dev-emulators/…')`
  resolves in-repo but not from the published bundle — `@internal/*` are
  private workspace packages that npm consumers never receive. S5 changes
  `ensureDaemon` to take the resolved `entry` path from its caller and adds
  public daemon-entry subpaths on `@prisma/composer-prisma-cloud` that the
  extension resolves against its own package, making the published dist
  self-contained. Until then the in-repo resolution stands.

#### `compute-main.ts` — the Compute emulator (subpath `/compute-main`)

A small local counterpart of the platform's compute service: it owns the
service child processes. Loopback `node:http` JSON admin API; state under its
`--state-dir` (apps registry JSON + `logs/<app>/<service>.log`):

- `GET /health` → `{ "version": string }`.
- `PUT /apps/<app>/services/<id>` (empty body) → `{ "port": number, "url":
  string }`. Port stable per (app, id): persisted in emulator state,
  allocated smallest ≥ 3000 unused across ALL apps' services. Idempotent.
- `PUT /apps/<app>/services/<id>/deployment` body `{ "address": string,
  "artifactDir": string, "artifactHash": string, "env": Record<string,
  string>, "port": number }` → `204`. Start rules: a child that is
  `running` restarts iff `artifactHash` or `env` changed (SIGTERM old, 5 s
  grace, SIGKILL); a service that is `stopped`, `held`, or has never run
  ALWAYS starts — an explicit converge is an operator action, so a
  deployment PUT clears `held` and undoes a prior app `stop`. Spawn:
  `bun bootstrap.js` with `cwd: artifactDir` and EXACTLY the request's
  `env` — no inheritance from the daemon's own environment; the provider
  already merged `PATH`/`HOME`. `bun` is resolved from the request env's
  `PATH` at each spawn; missing → `500` with body
  `local dev runs services under bun — the Prisma Compute runtime — and \`bun\` was not found on PATH. Install it: https://bun.sh.`
  (fails the converge with that message). A child that dies instantly with
  a bind error (`EADDRINUSE` — a foreign process holds its port) is not
  special-cased: it takes the normal backoff→held path and the cause is in
  its log stream.
- `GET /apps/<app>/services` → `[{ "id", "address", "port", "url",
  "status": "running" | "backoff" | "held" | "stopped", "pid"?,
  "lastExitCode"?, "artifactHash"?, "logPath" }]`.
- `GET /apps/<app>/services/<id>/logs?follow=1` → chunked plain text: the
  log file's current tail, then live lines while open.
- `POST /apps/<app>/stop` → stop every child of the app (records kept,
  status `stopped`) → `204`.
- `DELETE /apps/<app>` → stop + remove the app's records and logs → `204`.

Supervision policy (emulator-owned): unexpected exit → restart with backoff
1 s · 2ⁿ capped at 30 s, counter reset after 30 s of uptime; 5 consecutive
sub-30 s exits → status `held` (no more restarts) until the next deployment
PUT (see the start rules above). Every supervision event is written into
the service's own log stream prefixed `[emulator]` (e.g.
`[emulator] exited (code 1) — restarting in 2s`).

API hygiene, both daemons: `<app>`, `<id>`, and `<name>` path segments must
match `/^[a-z0-9][a-z0-9-]*$/` (≤ 63 chars) → `400` naming the segment
otherwise; all state-file writes are temp-then-rename behind one in-process
queue (the daemons are single-process; concurrent HTTP handlers serialize
state mutation through it); log files are append-only with no rotation in
v1 (recorded limitation — `--fresh` clears an app's logs via
`DELETE /apps/<app>`).

#### `buckets-main.ts` — the bucket emulator (subpath `/buckets-main`)

The S3 wire (`@internal/s3-protocol`'s handler + SigV4) over `fsStore`, with
the bucket-name → directory resolver fed from registrations. Multi-tenant:
physical bucket names are `<app>--<name>`; each bucket's directory is
registered by the provider (an in-project path, so objects stay browsable in
the app's own working tree). Admin under `/_pcdev/` (the underscore cannot
collide with a valid bucket name); registrations and accepted credentials
persist in `<state-dir>/state.json`, mode `0600`:

- `GET /health` → `{ "version": string }` (also at `/_pcdev/health`).
- `PUT /_pcdev/apps/<app>/buckets/<name>` body `{ "dir": string }` →
  register physical `<app>--<name>` → `dir`, mkdir, `204`. Idempotent.
  The PHYSICAL name must satisfy the store's bucket-name rule (incl. its
  63-char cap) → `400` naming both parts and the cap otherwise. A
  registered dir the developer has since deleted is re-created lazily on
  the next object write.
- `PUT /_pcdev/apps/<app>/credentials` body `{ "accessKeyId",
  "secretAccessKey" }` → upsert keyed by `accessKeyId`, **recorded as owned
  by `<app>`** (same key + new secret replaces; a key already owned by a
  DIFFERENT app → `409` naming neither secret), persist, `204`. Idempotent.
- `DELETE /_pcdev/apps/<app>` → remove the app's registrations and
  credentials (object directories are NOT deleted — they live in the app's
  working tree and `teardown`'s `fs.rm` owns them) → `204`.

S3 requests authenticate per tenant: the target bucket's owning app is
resolved from the bucket's REGISTRATION RECORD (which stores it), never by
splitting the physical name — the segment rule permits `-` runs, so
`<app>--<name>` is not reversible — and SigV4 is verified against ONLY that
app's accepted credentials. A valid signature from another
app's credential is rejected exactly like a bad signature — cross-app access
is impossible and the rejection reveals nothing about the bucket's
existence. Multipart upload endpoints: `501` with body
`multipart upload is not supported by the local dev bucket emulator yet`.

#### `client.ts`

Typed loopback clients for both daemons (`computeClient()` /
`bucketsClient()`), resolving the port from the registry; a dead or absent
daemon surfaces as
`Error: the <name> emulator is not running — \`prisma-composer dev\` starts it via the extension's dev.emulators hook.`
Used by the local providers (§ 4) and the extension's `emulators`/`attach`/
`teardown` implementations (§ 5).

### 3. `@prisma/composer` core (`packages/0-framework/1-core/core`)

`src/control/app-config.ts` — add, exported through `exports/app-config.ts`:

```ts
/** Local counterparts for `prisma-composer dev` (ADR-0041). An extension without one is not dev-capable. */
export interface DevDescriptor {
  /** Local providers for the SAME resource types this extension's lowering emits. Receives the app identity — unlike deploy's env-arg-free `providers()`, local providers are emulator clients and must know which app they provision for. */
  providers(input: DevProvidersInput): Layer.Layer<never>;
  /** A stable local identity — resolved without any platform call. */
  readonly container: ContainerDescriptor;
  /** Dev value sourcing (secrets/env-params) — runs where deploy's preflight runs. */
  preflight?(input: PreflightInput): Promise<void>;
  /** Ensure the emulator daemons this topology's node kinds need are running (idempotent; they persist across sessions). */
  emulators?(input: DevEmulatorsInput): Promise<void>;
  /** The dev session's view of the running app. Core renders it and never learns an emulator's API. */
  attach(input: DevAttachInput): Promise<DevAttachment>;
  /** `--fresh`: remove every local trace of the dev instance — emulator instances, state, data. */
  teardown?(input: TeardownInput): Promise<void>;
}

export interface DevProvidersInput {
  /** This extension's resolved dev container (its `input.appName` is the emulator app namespace). */
  readonly container: ContainerInstance | undefined;
  /** Absolute path of the dev state directory (`<cwd>/.prisma-composer/dev`). */
  readonly devDir: string;
}

export interface DevEmulatorsInput {
  /** The loaded application graph — inspected for which node kinds need an emulator. */
  readonly graph: Graph;
  readonly container: ContainerInstance | undefined;
  /** Absolute path of the dev state directory (`<cwd>/.prisma-composer/dev`). */
  readonly devDir: string;
}

export interface DevAttachInput {
  readonly container: ContainerInstance | undefined;
  readonly devDir: string;
}

export interface DevAttachment {
  /** Every service's local endpoint, for the front door. */
  endpoints(): Promise<readonly { readonly address: string; readonly url: string }[]>;
  /** Merged, line-oriented log stream across the app's services (including services that appear after later converges). Ends when `signal` aborts. */
  logs(signal: AbortSignal): AsyncIterable<{ readonly service: string; readonly line: string }>;
  /** Stop the app's service instances (emulators and data persist). */
  stopServices(): Promise<void>;
}

export const DEV_DIR = '.prisma-composer/dev';
```

and on `ExtensionDescriptor`:

```ts
  /** Local dev counterparts (ADR-0041). */
  readonly dev?: DevDescriptor;
```

`src/control/deploy.ts`:

- `Bundle` gains `readonly watch?: readonly string[]` — absolute paths to
  the USER-BUILT inputs this bundle was assembled from; the dev watch loop
  watches exactly these (a file entry is watched as a file, a directory
  entry recursively). Optional so existing adapters compile; every
  first-party adapter populates it (see below) and a bundle without it is
  simply not watched (recorded limitation, surfaced by a one-line
  `[dev] <address> has no watchable inputs` note at startup).
- Adapters populate `watch`: `node()` → `[resolved entry file]`; `nextjs()`
  → `[the standalone output dir]`; `dir()` (§ 7) → `[the resolved dir]`.
- `LowerOptions` gains `readonly dev?: boolean`.
- New `export function mergedDevProviders(config: PrismaAppConfig,
  containers: ReadonlyMap<string, ContainerInstance>, devDir: string):
  Layer.Layer<never>` — like `mergedProviders` but calling
  `extension.dev.providers({ container: containers.get(extension.id),
  devDir })`; an extension with `dev === undefined` throws `LowerError` with
  message exactly:
  `extension "<id>" has no dev support — it declares no \`dev\` descriptor (ADR-0041).`
  **Build-only exemption:** an extension participating in assembly only —
  every `nodes` entry is `kind: 'build'` AND it declares none of
  `providers`/`application`/`provisions`/`container` — has nothing to
  emulate and is exempt: `mergedDevProviders` skips it silently, and every
  dev hook iteration (containers, preflight, emulators, attach, teardown —
  § 6) applies the same rule. Export the predicate as
  `isBuildOnlyExtension(extension)` in `app-config.ts` so the CLI and
  `mergedDevProviders` share one definition.
- `lower()`: when `opts.dev === true`, use `mergedDevProviders(config,
  containers, path.join(process.cwd(), DEV_DIR))` — `containers` is the map
  `lower()` already deserializes from the env transport; state resolution is
  unchanged (`resolveStateLayer` — dev passes `opts.state`, which already
  takes precedence).

There is no framework-owned process table: service processes belong to the
Compute emulator (§ 2), and core's whole view of the running app is the
`DevAttachment` the extension returns.

### 4. `@internal/lowering` (`packages/1-prisma-cloud/0-lowering/lowering`)

New directory `src/dev/`, exported as subpath `@internal/lowering/dev`
(add to `src/exports/` per `.agents/rules/exports-entrypoints.mdc`; plane
`control` like the rest of the package).

#### `src/dev/dev-store.ts` — the shared dev-instance store

All JSON files under `<cwd>/.prisma-composer/dev/`, written
temp-then-rename, guarded by ONE in-process async mutex per file (providers
run concurrently inside the one alchemy child; nothing else writes them):

- `env.json` — `Record<string, string>`: every `EnvironmentVariable` row,
  key → value. Last write wins (matches platform semantics: one project-wide
  namespace; `alchemy-lowering.md` § Placement).
- `secrets.json` — `Record<string, string>`: platform var name → value
  (shell-sourced or minted placeholder). File mode `0o600`.
- `postgres.json` — `Record<string, { instance: string; url: string }>`:
  Database resource name → its `prisma dev` instance name and URL.

Ports live nowhere here: service ports are the Compute emulator's own state
(stable per (app, service)); emulator daemon ports live in the daemon
registry (§ 2).

#### `src/dev/compute.ts` — local compute cluster providers

Every local provider factory takes `(input: DevProvidersInput)`; `devDir`
is `input.devDir`; nothing here reads `process.cwd()` or the environment.
The emulator-facing service id is `slugServiceId(name)` (the same
lowercase/hyphen slugging as postgres instance names) because a dotted
address cannot satisfy § 2's id-segment rule; the real dotted address rides
the deployment body and labels logs/endpoints.
Two layer-order accommodations are pinned (this package cannot import the
extensions layer): the app name is read as `input.container.input.appName`
directly off the generic `ContainerInstance` (the field is on the base
interface; it is the same value `prismaCloudContainerOf` would yield), and
the Deployment provider's env-key formula is an inline duplicate of the
extensions-layer `configKey`, documented at both sites as a wire-protocol
match. Giving these a shared home below both layers is recorded follow-up
scope, not v1.

- `LocalComputeServiceProvider(input)`: `reconcile` calls the Compute
  emulator — `PUT /apps/<app>/services/<news.name>` (idempotent) →
  `{ port, url }`; returns `{ id: news.name,
  name: news.name, endpointDomain: url }`. An unreachable emulator surfaces
  `client.ts`'s not-running error. `list` → `[]`; `delete` →
  `DELETE`-less no-op (instance removal is `teardown`'s, via
  `DELETE /apps/<app>`); `read` → echo `output`.
- `LocalEnvironmentVariableProvider(input)`: `reconcile` writes
  `news.key → news.value` into `env.json`, returns
  `{ id: news.key, key: news.key }`. `delete` removes the key. Handles the
  poison rows (`DATABASE_URL` = `-`) like any other — parity is the point.
- `LocalDeploymentProvider(input)`: `reconcile`:
  1. Unpack `news.artifactPath` (tar.gz, the ustar format
     `packageComputeArtifact` writes) into
     `<devDir>/artifacts/<artifactHash>/` if absent — implemented by a new
     `src/compute/artifact-extract.ts` (`extractComputeArtifact(tarGzPath,
     destDir)`), a minimal ustar reader matching exactly what the writer
     emits: regular files, name+prefix fields, no links (error on any other
     typeflag). Extraction goes temp-then-rename at the directory level.
  2. Fetch the service's port: `PUT /apps/<app>/services/<id>` (idempotent)
     where `id` = the ComputeService's name resolved from
     `news.computeServiceId`. Resolve the address from
     `news.serviceAddress` (see § lowering handoff change).
  3. Materialize env SCOPED to the service: every `env.json` row whose key
     is prefixed `COMPOSER_<address>_` (the address of the row's OWNER —
     `configKey`'s convention) plus every row OUTSIDE the `COMPOSER_`
     namespace (the poison `DATABASE_URL(_POOLED)` rows are deliberately
     unprefixed and app-wide); then override `configKey(address, { owner:
     'service', name: 'port' })` = `JSON.stringify(port)`, then merge
     `secrets.json` entries verbatim (raw platform names), then `PATH` and
     `HOME` from the current process env.
     **Pinned parity note:** the hosted platform materializes the app-wide
     row set into every deployment but DIFFS a deployment only on its own
     referenced rows — an app-wide local materialization therefore
     restart-amplifies (an early-deployed service's snapshot is incomplete
     on the first converge, "completes" on the second, and diffs as
     changed; observed live, three-converge byte evidence). Scoping the
     content aligns local restart behavior with the platform's diff scope;
     the dropped sibling rows have no sanctioned reader (`run()`/`load()`
     consume only own-address rows, and ambient sibling reads are exactly
     what the poison rows exist to punish).
  4. `PUT /apps/<app>/services/<id>/deployment` with `{ address,
     artifactDir, artifactHash, env, port }` — the emulator (re)starts the
     child only when the hash or env changed.
  5. Return `{ deploymentId: news.artifactHash, deployedUrl:
     \`http://localhost:${port}\` }`.
  `delete` is a no-op — unpacked artifacts are content-addressed and cheap,
  and `--fresh` removes the whole dev dir (instance removal is
  `teardown`'s).
- `LocalProjectProvider(input)`: identity only — `reconcile` returns
  `{ id: 'local', ... }` shapes; present so the provider collection stays
  total, though current lowerings never yield `Project`.

#### `src/dev/postgres.ts` — local postgres cluster providers

- Instance name derivation: `pcdev-<app>-<database-id>`, where `<app>` and
  `<database-id>` are lowercased with every char outside `[a-z0-9]` replaced
  by `-`, runs collapsed, trimmed to 63 chars.
- Bin resolution: walk up from cwd for `node_modules/.bin/prisma` (the
  `resolveAlchemyBin` pattern, generalized as `resolveLocalBin(startDir,
  binName)` in `src/dev/resolve-bin.ts`). Missing →
  `Error: local dev needs the prisma CLI for its local Postgres emulator ('prisma dev') — add "prisma" to your app's devDependencies.`
- `LocalDatabaseProvider(input)`: `reconcile` ensure sequence:
  1. No `postgres.json` entry → run
     `<prisma-bin> dev --name <instance> --detach`, capture stdout, take the
     LAST non-empty line as the connection URL (the port's proven contract —
     verified against prisma dev v0.16); anything else →
     `Error: could not read the database URL from "prisma dev --name <instance> --detach"; output was: <sanitized output>`
     where `<sanitized output>` is the captured output with every
     connection-URL credential masked (`output.replace(/:\/\/([^:@\/\s]+):[^@\/\s]+@/g, '://$1:***@')`)
     — the behavior contract's no-value-logging rule applies to embedded
     diagnostics too. Record `{ instance, url }` keyed by `news.name`.
  2. Entry exists → TCP-probe the recorded URL's host:port (500 ms). 
     Reachable → done.
  3. Unreachable (instance stopped — machine reboot, `prisma dev stop`) →
     run `<prisma-bin> dev start <instance>`; re-probe for up to 10 s.
     Still unreachable →
     `Error: the local Postgres instance "<instance>" did not come back on <host:port> — run \`prisma dev rm <instance>\` and retry (or \`prisma-composer dev --fresh\`).`
  **Verified (S4):** `prisma dev start <name>` restores a stopped instance
  on its ORIGINAL port (probe: create → stop → confirm unreachable → start
  → same port reachable; prisma dev v0.16). The TCP-probe → `start` →
  re-probe sequence above is the implemented path; the `--db-port` fallback
  is retired unneeded.
  Return `{ id: instance, name: news.name }`-shaped attributes mirroring
  the hosted provider's attribute type.
- `LocalConnectionProvider(input)`: `reconcile` scans `postgres.json`
  values for the entry whose `instance` equals `news.databaseId` (the
  Database attributes' `id` IS the instance name) and returns
  `connectionString` = `Redacted.make(url)` matching the hosted attribute
  shape exactly (the postgres/prisma-next descriptors call `Redacted.value`
  on it). No matching entry →
  `Error: no local Postgres instance recorded for databaseId "<id>" — the Database provider did not run; converge is corrupt (try --fresh).`
- `PgWarm`/`PnMigration` are NOT here — the hosted ones run as-is.

#### `src/dev/bucket.ts` — local bucket cluster providers

Both are clients of the machine-global bucket emulator (§ 2 — the daemon is
already up: the extension's `dev.emulators` hook ensured it before converge;
unreachable surfaces `client.ts`'s not-running error). Both take
`(input: DevProvidersInput)` like every local provider factory.

- `LocalBucketProvider(input)`: `reconcile` →
  `PUT /_pcdev/apps/<app>/buckets/<news.name>` with
  `{ dir: <devDir>/buckets/<news.name> }` (in-project, browsable); returns
  `{ id: news.name }`-shaped attributes.
- `LocalBucketKeyProvider(input)`: mint-once-stable like `ServiceKey` (the mint
  is `@internal/s3-protocol`'s `mintKeyPair`). `reconcile` →
  `PUT /_pcdev/apps/<app>/credentials` with the (prior or freshly minted)
  pair — re-PUT on every reconcile, which self-heals an emulator whose
  state was wiped. Attributes: `{ endpoint: <emulator url>, bucketName:
  \`<app>--<news.name>\`, accessKeyId, secretAccessKey }` — the PHYSICAL
  bucket name rides the binding, so consumers address the emulator's
  namespace-safe name and cross-app collisions are impossible (matching the
  hosted `BucketKey` attribute names the bucket descriptor reads).
- `list` → `[]`, `delete` → no-op (objects belong to the developer;
  `--fresh` deletes), `read` → echo output. Both providers.

#### `src/dev/providers.ts`

```ts
export const devProviders = (input: DevProvidersInput) =>
  Layer.effect(
    Providers,               // the SAME ProviderCollection tag as providers()
    Provider.collection([Project, Database, Connection, ComputeService,
      Deployment, EnvironmentVariable, Bucket, BucketKey]),
  ).pipe(Layer.provide(Layer.mergeAll(
    LocalProjectProvider(input), LocalDatabaseProvider(input),
    LocalConnectionProvider(input), LocalComputeServiceProvider(input),
    LocalDeploymentProvider(input), LocalEnvironmentVariableProvider(input),
    LocalBucketProvider(input), LocalBucketKeyProvider(input),
  )));
```

No `ManagementClient`, no credentials layer — the dev bundle must typecheck
without either.

#### Lowering handoff change (shared with deploy — compile-checked)

`DeploymentProps` gains `readonly serviceAddress?: string`. The hosted
provider ignores it (documented on the prop: local-dev only; the hosted
platform derives nothing from it). `descriptors/compute.ts`: add
`address: string` to `ComputeSerialized`, populated from `ctx.address` in
`serialize`, threaded into the `Deployment` call in `deploy` as
`serviceAddress`. The local provider REQUIRES it:
`Error: Deployment for "<computeServiceId>" carries no serviceAddress — the lowering predates local dev support.`

### 5. Target extension (`packages/1-prisma-cloud/1-extensions/target`)

New control-plane files (all under `src/`, plane `control` in
`architecture.config.json`):

- `src/dev/container.ts` — `devContainerDescriptor():
  ContainerDescriptor<PrismaCloudContainer>`: `ensure`/`locate` both return
  `new PrismaCloudContainer({ appName, stage: undefined }, 'local',
  undefined)` synchronously-resolved; `remove` is a no-op; `deserialize`
  reuses container.ts's existing `deserialize`. `projectId` is the literal
  `'local'`. No env reads, no client.
- `src/dev/preflight.ts` — `runDevPreflight(input: PreflightInput)`:
  1. Collect names exactly as `runPreflight` does (same `provisionManifest` /
     `paramManifest` + `isEnvParamSource` walk — extract the shared
     name-collection into `src/preflight-names.ts` used by both, so the two
     can never drift).
  2. Secrets: for each name — `process.env[name]` non-empty → store that
     value in `secrets.json`; else reuse the persisted placeholder if
     present; else mint `local-placeholder-<16 lowercase hex>` (Web Crypto),
     persist, and `console.warn` exactly:
     `[dev] <NAME> is not set in this shell — using a local placeholder. Anything that talks to the real service behind it will fail; everything else runs.`
  3. Env-sourced params: shell value → `secrets.json`; missing → collect and
     throw one error listing all, formatted like preflight.ts's
     `missingError` but scoped `local dev` and instructing
     `Set each in the shell you run \`prisma-composer dev\` from.`
- `src/dev/emulators.ts` — `runDevEmulators(input: DevEmulatorsInput)`:
  inspect the graph's node kinds; `ensureDaemon('compute')` always (every
  app has services); `ensureDaemon('buckets')` when any `s3`-kinded resource
  node exists. Postgres needs no pre-start — its instances are created at
  provision through the ORM CLI. Idempotent; prints one `[dev]` line per
  daemon it actually started.
- `src/dev/attach.ts` — `devAttach(input: DevAttachInput): DevAttachment`,
  a Compute-emulator client scoped to the app:
  - `endpoints()` → `GET /apps/<app>/services`, mapped to
    `{ address, url }` — every listed service regardless of status (URLs
    are stable; a held service's URL is still where it will serve).
  - `logs(signal)` → follow each listed service's
    `logs?follow=1` stream, merged and line-labelled; re-list every 2 s,
    attaching followers for services that appeared after a later converge
    and re-attaching any follower whose connection dropped (an emulator
    restart shows a gap, never a dead session).
  - `stopServices()` → `POST /apps/<app>/stop`.
- `src/dev/teardown.ts` — `runDevTeardown(input: TeardownInput)`:
  1. `<prisma-bin> dev stop 'pcdev-<slug(app)>-*'` then
     `<prisma-bin> dev rm 'pcdev-<slug(app)>-*'` — the glob applies the SAME
     name slugging § 4's instance derivation uses (one shared `slug`
     implementation), or an app name containing slugged characters would
     orphan its instances (glob per the CLI's stop/rm NAME pattern support;
     tolerate nonzero exit when no instance matches — match on the CLI's
     "not found"-style output, otherwise rethrow with output).
  2. Compute emulator: `DELETE /apps/<app>` (stops children, removes records
     and logs). Bucket emulator: `DELETE /_pcdev/apps/<app>` (removes
     registrations + credentials). Both tolerate an unreachable or absent
     daemon — the machine-global daemons themselves are NEVER stopped by
     `--fresh` (other apps may be using them).
  3. `fs.rm` `<cwd>/.prisma-composer/dev` recursively.
  4. `fs.rm` `<cwd>/.alchemy/state/<app>/dev` recursively (the localState
     stage dir; tolerate absence).
- `control/extension.ts` — `prismaCloud()` returns, additionally:

```ts
    dev: {
      container: devContainerDescriptor(),
      providers: (input) => asProvidersLayer(Layer.mergeAll(
        Prisma.devProviders(input),
        PgWarmProvider(),
        PnMigrationProvider(),
        S3CredentialsProvider(),
        Prisma.ServiceKeyProvider(),
      )),
      preflight: (input) => runDevPreflight(input),
      emulators: (input) => runDevEmulators(input),
      attach: (input) => devAttach(input),
      teardown: (input) => runDevTeardown(input),
    },
```

  **Factory env requirements**: `resolveOptions` runs for deploy fields and
  currently throws without `PRISMA_WORKSPACE_ID`. Restructure: resolve lazily
  — `resolveOptions` moves inside the deploy-side descriptor closures that
  need `workspaceId`/`region` (the `nodes` descriptors take `o` today;
  instead pass a thunk `() => ResolvedCloudOptions` evaluated at first
  lowering use). `prismaCloud()` itself must construct with NO environment
  present. `PROVIDER_PARAMS` needs no env — unchanged. Verify with a test
  that `prismaCloud()` succeeds in a scrubbed env and `prisma-composer dev`
  never reads `PRISMA_WORKSPACE_ID`/`PRISMA_SERVICE_TOKEN`/`PRISMA_REGION`.

### 6. CLI (`packages/0-framework/3-tooling/cli`)

- `src/main.ts`: new `DevCommand` (`paths = [['dev']]`), options: `entry`
  (positional, required), `--name` (same override semantics as deploy),
  `--fresh` (boolean, default false). `ParsedArgs.command` widens to
  `'deploy' | 'destroy' | 'dev'`. `--stage`/`--production` do not exist on
  dev (clipanion rejects them as unknown flags → usage error).
- `src/dev/` — the dev pipeline + view (all new; `plane: control` via
  the existing CLI glob):
  - `run-dev.ts` — `runDev(args, deps)`:
    1. Steps 1–6 of `run()` reused verbatim (extract the shared prefix of
       `run()` into `src/pipeline.ts` — config discovery/load, entry load,
       Load, coverage validation, name resolution, assemble — so deploy and
       dev cannot drift; `run()` is refactored to consume it).
    2. Dev-capability check: every configured extension that is NOT
       build-only (core's `isBuildOnlyExtension`, § 3) has `dev` — else
       `CliError`:
       `extension "<id>" has no local dev support (no \`dev\` descriptor) — remove it from prisma-composer.config.ts or update it.`
       Build-only extensions pass through: assembly still uses them; every
       dev hook iteration skips them.
    3. Containers: `dev.container.ensure({ appName: name, stage: undefined })`
       per extension — safe before anything else: dev containers are purely
       local and cannot fail on corrupt state.
    4. `--fresh`: call each extension's `dev.teardown({ container:
       <its resolved dev container>, stage: undefined })`, then continue
       cold. (Teardown derives instance names from the container's
       `input.appName`.)
    5. Preflight: `dev.preflight` per extension (always — dev has no
       deploy/destroy split).
    6. Emulators: `dev.emulators({ graph, container, devDir })` per
       extension that declares it.
    7. Write the dev stack file (below); run
       `runAlchemy({ command: 'deploy', stackFileRelativePath:
       DEV_STACK_RELATIVE_PATH, cwd, stage: 'dev', containerEnv })`.
       Nonzero exit: print the stack-file reproduction hint (deploy's
       pattern, with `--stage dev`) and exit with that status.
    8. Attach: `dev.attach({ container, devDir })` per extension; print the
       front door from the merged `endpoints()` (ordered by address depth,
       fewest dots first, then lexicographic; first line preceded by
       `[dev] ready:`); pump every attachment's `logs()` to stdout, each
       line prefixed `[<service>] `; the CLI's own lines are `[dev] `.
    9. Watch loop (below) until SIGINT/SIGTERM; on exit call every
       attachment's `stopServices()`, then exit 0 — emulators and data stay
       up by design (machine-scoped daemons; `--fresh` removes instances).
       Recorded limitation: the dev command becomes the SOLE signal
       listener at this point (alchemy's transitively imported library code
       registers exit-on-signal listeners at module load; they are stripped
       so cleanup can run), so a second Ctrl-C does not force-quit a hung
       stop — the emulator's kill grace bounds it in practice.
       Recorded follow-up: `PreflightInput` carries no `devDir`, so the dev
       preflight derives it from `process.cwd()` — correct under the CLI
       (which runs from the app dir) but asymmetric with every other dev
       hook; adding `devDir` to the input is future work, not v1.
  - `generate-dev-stack.ts` — like `generate-stack.ts` but at
    `.prisma-composer/dev/alchemy.run.ts`
    (`DEV_STACK_RELATIVE_PATH`), emitting:

    ```ts
    import { lower } from '@prisma/composer/deploy';
    import { localState } from 'alchemy/State/LocalState';
    import config from <configImport>;
    import app from <appImport>;
    export default lower(app, config, {
      name: <name>,
      bundles: { ... },
      dev: true,
      state: localState(),
    });
    ```

    No `report` (dev prints its own front door). Header comment mirrors the
    deploy one with `alchemy deploy .prisma-composer/dev/alchemy.run.ts --stage dev`
    as the reproduction line.
  - `watch.ts` — watch each assembled bundle's `watch` paths (the
    adapter-declared user-built inputs — § 3's `Bundle.watch`; a bundle
    without them is not watched, noted once at startup). `fs.watch`
    recursive on dirs, plain on files; debounce 300 ms per burst, coalescing across
    services. On fire: re-run assemble for ALL services (correctness over
    cleverness; optimization is a recorded follow-up) → rewrite the dev stack
    file → re-run converge (`--stage dev`) — the emulator restarts exactly
    the services whose deployments were re-put. Converge failure during
    watch: print the error, keep the running topology untouched, keep
    watching (a broken build must not take down the running app). After
    every successful converge, re-print the front door from `endpoints()`.

### 7. Directory-shaped builds (REVISED — no new adapter)

**Correction (operator catch):** `node()`'s directory form —
`node({ module, dir, entry })` — already exists on `main` and IS friction
#3's fix, implemented before this project's design pass; the original § 7
pinned a duplicate `dir()` surface against a stale friction-log premise.
There is no `dir()` adapter and no `@prisma/composer/dir` subpath. S2's
real scope:

- `Bundle.watch` (§ 3) and its population: `node()` single-file form →
  `[resolved entry file]`; `node()` directory form → `[the resolved dir]`
  (the WHOLE tree — a rebuild may touch only sibling files); `nextjs()` →
  `[the standalone output dir]`.
- The symlink-as-`dir` hole: `node()`'s directory form on `main`
  dereferences a symlink passed AS `dir` itself (`statSync` follows links;
  the no-symlink walk only checks children) — `lstat` the directory before
  the walk, ADR-0005's error shape, tests through the directory form.
- Doc corrections wherever the guide/deploy docs still describe `node()`
  as single-file-only.

The open-chat proof (S6) uses `node({ module, dir, entry })`.

### 8. Docs & rules

- `docs/design/10-domains/local-dev.md` — already aligned; final pass in the
  last slice for anything the implementation forced (each such change also
  lands in this spec first).
- `docs/design/10-domains/deploy-cli.md` — add the `dev` command to § Scope
  when it ships; move it out of § Out of scope.
- The publishable-surface docs/README for `@prisma/composer/dir`.
- `.gitignore` guidance: apps must ignore `.prisma-composer/` and
  `.alchemy/` — verify `examples/store`'s gitignore covers both; fix if not.

## Behavior contracts (cross-cutting)

- **No new runtime dependencies** in any shipped package. The S3 server,
  tar reader, watcher, and emulator daemons use node built-ins only. (`alchemy`,
  `effect`, `clipanion` are already present.)
- **Casts**: `.agents/rules/no-bare-casts.mdc` — every cast is `blindCast`
  with a justification, or real narrowing. The provider attribute shapes are
  typed against the hosted providers' exported types, not re-declared.
- **Values never logged**: secret values, connection URLs (log them
  password-masked exactly as the port's dev.ts did:
  `url.replace(/:[^/:@]*@/, ':***@')`).
- **Determinism**: no `Date.now()`-seeded names or ports; every allocation
  and minted value is persisted and stable across restarts.
- **Windows**: out of scope, recorded: dev requires a POSIX host (daemon
  signalling and `prisma dev` assume it); fail on `process.platform ===
  'win32'` with `local dev is not supported on Windows yet.`

## Acceptance criteria (project DoD)

- [ ] `prisma-composer dev src/<entry>.ts` on `examples/store` brings up every
      service credential-free: no `PRISMA_*` env present in the shell, HTTP
      round-trip against the front-door URL succeeds.
- [ ] Editing + rebuilding one service's source restarts only that service
      (observed via `[dev]` logs), and the restarted service serves the new
      behavior.
- [ ] Postgres-backed service: data written before Ctrl-C is readable after
      the next `prisma-composer dev` start; gone after `--fresh`.
- [ ] Bucket-backed flow (storage module or native `bucket()`): an object PUT
      through the app appears as a plain file under
      `.prisma-composer/dev/buckets/`, and a file dropped there is readable
      through the app.
- [ ] A missing secret produces the placeholder warning and a running
      topology; a missing env-sourced param fails with the listing error.
- [ ] After Ctrl-C, a second `prisma-composer dev` reaches ready as a warm
      start: same service ports and URLs, no re-provisioning, Postgres and
      bucket data intact.
- [ ] The open-chat port (via the `dir()` adapter) boots through
      `prisma-composer dev` with sign-in, history, and live-tail working —
      replacing its hand-rolled `scripts/dev.ts` (parity proof; port-repo
      changes land there, findings land here).
- [ ] Restart-latency measurement for `examples/store` recorded in the
      close-out notes (target: single-digit seconds; a miss is a recorded
      follow-up, not a DoD failure).
- [ ] Workspace-wide `pnpm typecheck && pnpm test && pnpm lint && pnpm
      lint:deps` green; storage module tests pass unmodified post-extraction.
- [ ] Docs migrated per close-out: local-dev.md final, deploy-cli.md scope
      updated, ADR-0041 consistent with what shipped.

## Open questions

(none — a gap found during implementation is recorded here and raised, not
improvised around)
