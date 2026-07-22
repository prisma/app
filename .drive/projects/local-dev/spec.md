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
`dev` descriptor field, then supervises the resulting process table — spawning
one child per service from its real packaged artifact, restarting on rebuild,
streaming logs — until interrupted. Stand-ins: ORM `prisma dev` per Database,
a disk-backed S3 server for buckets, child processes for compute. The lowering
(`nodes`/`provisions`) is byte-identical to deploy; parity holds by
construction above the Alchemy provider boundary.

## Settled decisions (do not relitigate)

| # | Decision | Where recorded |
|---|---|---|
| D1 | Dev = the deploy pipeline retargeted at the Alchemy **provider** boundary; never an HTTP Management-API emulation, never a bespoke per-kind dev harness | ADR-0041 |
| D2 | The seam is `ExtensionDescriptor.dev?: DevDescriptor` — `providers`, `container`, `preflight`, `standIns`, `teardown`; **no `nodes`, no `provisions`, no `state`** | ADR-0041 |
| D3 | Dev Alchemy state = alchemy's own `localState()` via the existing `LowerOptions.state` override, always at Alchemy stage `dev` | ADR-0041 |
| D4 | Converge terminates; local `Deployment` writes desired-process records; the long-running dev command supervises them | ADR-0041 |
| D5 | Postgres stand-in = ORM `prisma dev`, one named detached instance per `Database` resource; instances survive Ctrl-C, removed only by `--fresh` | local-dev.md |
| D6 | Bucket stand-in = the storage module's S3 protocol handler + SigV4 over a new disk `ObjectStore`; protocol pieces extracted DOWN to a lowering-layer package both can import | local-dev.md |
| D7 | Secrets: shell env else minted persisted placeholder + warning. Env-sourced params: shell env else **hard error** | ADR-0041 |
| D8 | Children are spawned under **bun** (Compute's runtime) from the real packaged artifact's `bootstrap.js` — the deployed boot path, no bypass | ADR-0041 |
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

- `fs-store.ts` — `export function fsStore(rootDir: string): ObjectStore`.
  Mapping:
  - Object bytes: `<rootDir>/<bucket>/<key>` — the key's `/` segments become
    directories. Writes are write-temp-then-rename
    (`<rootDir>/.tmp/<uuid>` → target) so a concurrent read never sees a
    partial object.
  - Metadata sidecar: `<rootDir>/.meta/<bucket>/<key>.json` containing
    `{ "contentType": string, "etag": string }`. `etag` = quoted SHA-256 hex
    of the object bytes (the store owns the ETag — store.ts's contract).
  - Key validation: reject (return the handler's error path) any key whose
    normalized path would escape the bucket dir (`..` segments, absolute
    paths, empty segments) and any key segment equal to `.meta` or `.tmp`.
    Reject bucket names not matching `/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/`.
  - A file present on disk without a sidecar (a developer dropped it in) is a
    valid object: `contentType` = `application/octet-stream`, etag computed
    on read and the sidecar written lazily. This is deliberate — droppable
    buckets are the feature.
  - `list`: lexicographic key order (walk + sort), `maxKeys` default 1000,
    `continuationToken` = the last returned key (opaque to callers), skip
    `.meta`/`.tmp`.
  - `delete`: remove object + sidecar, prune now-empty parent dirs up to the
    bucket dir; missing key is a no-op.
- `serve.ts` — `export function serveS3(opts: { port: number; store:
  ObjectStore; credentials: readonly { accessKeyId: string; secretAccessKey:
  string }[] }): Promise<{ readonly url: string; close(): Promise<void> }>`.
  Plain `node:http` (works under node and bun), adapting IncomingMessage →
  the fetch-style `Request` `createS3Handler` consumes and streaming the
  `Response` back. Accepts a request iff SigV4 verification passes against
  ANY of `credentials` (multiple bucket keys, one server). Binds `127.0.0.1`.
  Multipart upload endpoints: respond `501` with body text
  `multipart upload is not supported by the local dev bucket stand-in yet`.

Storage module keeps `pg-store.ts`, `storage-server.ts`, `handlers` etc. and
imports the moved pieces from `@internal/s3-protocol`. Its public exports
(`@prisma/composer-prisma-cloud/storage`, `/storage/testing`) are
byte-compatible — no consumer-visible change; existing storage tests must
pass unmodified (except import paths inside the package itself).

### 2. `@prisma/composer` core (`packages/0-framework/1-core/core`)

`src/control/app-config.ts` — add, exported through `exports/app-config.ts`:

```ts
/** Local counterparts for `prisma-composer dev` (ADR-0041). An extension without one is not dev-capable. */
export interface DevDescriptor {
  /** Local providers for the SAME resource types this extension's lowering emits. */
  providers(): Layer.Layer<never>;
  /** A stable local identity — resolved without any platform call. */
  readonly container: ContainerDescriptor;
  /** Dev value sourcing (secrets/env-params) — runs where deploy's preflight runs. */
  preflight?(input: PreflightInput): Promise<void>;
  /** Long-running stand-ins that must outlive a converge (e.g. a bucket server). */
  standIns?(input: DevStandInsInput): Promise<DevStandIns>;
  /** `--fresh`: remove every local trace of the dev instance. */
  teardown?(input: TeardownInput): Promise<void>;
}

export interface DevStandInsInput {
  /** The calling extension's own resolved dev container. */
  readonly container: ContainerInstance | undefined;
  /** Absolute path of the dev state directory (`<cwd>/.prisma-composer/dev`). */
  readonly devDir: string;
}

export interface DevStandIns {
  stop(): Promise<void>;
}
```

and on `ExtensionDescriptor`:

```ts
  /** Local dev counterparts (ADR-0041). */
  readonly dev?: DevDescriptor;
```

`src/control/deploy.ts`:

- `LowerOptions` gains `readonly dev?: boolean`.
- New `export function mergedDevProviders(config: PrismaAppConfig):
  Layer.Layer<never>` — like `mergedProviders` but reading
  `extension.dev.providers()`; an extension with `dev === undefined` throws
  `LowerError` with message exactly:
  `extension "<id>" has no dev support — it declares no \`dev\` descriptor (ADR-0041).`
- `lower()`: when `opts.dev === true`, use `mergedDevProviders(config)`; state
  resolution is unchanged (`resolveStateLayer` — dev passes `opts.state`,
  which already takes precedence).

`src/control/dev-process.ts` — NEW, exported via `exports/app-config.ts`
(control plane): the framework-owned process-table contract any target's dev
providers write and the CLI supervises.

```ts
/** One desired local service process — written by a dev Deployment provider, reconciled by the dev command. */
export interface DevProcessRecord {
  /** Schema version; this spec defines "1". A reader seeing an unknown version fails loudly. */
  readonly recordVersion: '1';
  /** The provisioned compute service's id — the record's identity and filename stem. */
  readonly serviceId: string;
  /** The service's full graph address (dotted). */
  readonly address: string;
  /** sha256 of the packaged artifact this process must run. */
  readonly artifactHash: string;
  /** Absolute path of the unpacked artifact directory (contains bootstrap.js). */
  readonly artifactDir: string;
  /** The COMPLETE child environment (COMPOSER_* rows, secret platform vars, PORT, PATH, HOME). */
  readonly env: Readonly<Record<string, string>>;
  /** The localhost port the service binds. */
  readonly port: number;
  /** The service's local URL (`http://localhost:<port>`). */
  readonly url: string;
}

export const DEV_DIR = '.prisma-composer/dev';
export const DEV_PROCESS_DIR = `${DEV_DIR}/processes`;

export function readDevProcessTable(cwd: string): DevProcessRecord[];
export function writeDevProcessRecord(cwd: string, record: DevProcessRecord): void;
export function deleteDevProcessRecord(cwd: string, serviceId: string): void;
```

Records live at `<cwd>/.prisma-composer/dev/processes/<serviceId>.json`,
written temp-then-rename. `readDevProcessTable` validates `recordVersion`
and every field's type with real narrowing (no casts — `.agents/rules/
no-bare-casts.mdc`), throwing an `Error` naming the file and field on
mismatch. `serviceId` must match `/^[a-z0-9][a-z0-9-]*$/` (it is a filename).

### 3. `@internal/lowering` (`packages/1-prisma-cloud/0-lowering/lowering`)

New directory `src/dev/`, exported as subpath `@internal/lowering/dev`
(add to `src/exports/` per `.agents/rules/exports-entrypoints.mdc`; plane
`control` like the rest of the package).

#### `src/dev/dev-store.ts` — the shared dev-instance store

All JSON files under `<cwd>/.prisma-composer/dev/`, written
temp-then-rename, guarded by ONE in-process async mutex per file (providers
run concurrently inside the one alchemy child; there is no cross-process
writer by design — the supervisor only reads these, and never during a
converge it did not itself start):

- `env.json` — `Record<string, string>`: every `EnvironmentVariable` row,
  key → value. Last write wins (matches platform semantics: one project-wide
  namespace; `alchemy-lowering.md` § Placement).
- `ports.json` — `Record<string, number>`: allocation name → port.
  Allocation names: `service:<serviceName>` and the reserved `s3`.
- `secrets.json` — `Record<string, string>`: platform var name → value
  (shell-sourced or minted placeholder). File mode `0o600`.
- `postgres.json` — `Record<string, { instance: string; url: string }>`:
  Database resource name → its `prisma dev` instance name and URL.

`allocatePort(cwd, name): number` — returns the existing allocation for
`name`, else the smallest integer ≥ 3000 not present in `ports.json` values,
persisting it. No OS probing — determinism wins; an actual bind conflict
surfaces at spawn and is covered by the error surface.

#### `src/dev/compute.ts` — local compute cluster providers

- `LocalComputeServiceProvider()`: `reconcile` returns prior `output` when
  present (stable identity + port). First create: `id` = `news.name`,
  `port` = `allocatePort(cwd, \`service:${news.name}\`)`,
  `endpointDomain` = `http://localhost:<port>`. `list` → `[]`; `delete` →
  release nothing (allocations persist; `--fresh` clears them); `read` →
  echo `output`.
- `LocalEnvironmentVariableProvider()`: `reconcile` writes
  `news.key → news.value` into `env.json`, returns
  `{ id: news.key, key: news.key }`. `delete` removes the key. Handles the
  poison rows (`DATABASE_URL` = `-`) like any other — parity is the point.
- `LocalDeploymentProvider()`: `reconcile`:
  1. Unpack `news.artifactPath` (tar.gz, the ustar format
     `packageComputeArtifact` writes) into
     `<devDir>/artifacts/<artifactHash>/` if absent — implemented by a new
     `src/compute/artifact-extract.ts` (`extractComputeArtifact(tarGzPath,
     destDir)`), a minimal ustar reader matching exactly what the writer
     emits: regular files, name+prefix fields, no links (error on any other
     typeflag). Extraction goes temp-then-rename at the directory level.
  2. Look up the service's port: `ports.json` key
     `service:<name>` where `name` is resolved from `news.computeServiceId`
     (equal to the ComputeService's `name` by construction above). Resolve
     the address from `news.serviceAddress` (see § lowering handoff change).
  3. Materialize env: `{ ...allOf(env.json) }`, then override
     `configKey(address, { owner: 'service', name: 'port' })` =
     `JSON.stringify(port)` (the serializer's service-own literal encoding),
     then merge `secrets.json` entries verbatim (raw platform names), then
     `PATH` and `HOME` from the current process env.
  4. Write the `DevProcessRecord` (core's `writeDevProcessRecord`).
  5. Return `{ deploymentId: news.artifactHash, deployedUrl:
     \`http://localhost:${port}\` }`.
  `delete` removes the record and the unpacked dir if no other record
  references its `artifactDir`.
- `LocalProjectProvider()`: identity only — `reconcile` returns
  `{ id: 'local', ... }` shapes; present so the provider collection stays
  total, though current lowerings never yield `Project`.

#### `src/dev/postgres.ts` — local postgres cluster providers

- Instance name derivation: `pcdev-<app>-<database-id>`, where `<app>` and
  `<database-id>` are lowercased with every char outside `[a-z0-9]` replaced
  by `-`, runs collapsed, trimmed to 63 chars.
- Bin resolution: walk up from cwd for `node_modules/.bin/prisma` (the
  `resolveAlchemyBin` pattern, generalized as `resolveLocalBin(startDir,
  binName)` in `src/dev/resolve-bin.ts`). Missing →
  `Error: local dev needs the prisma CLI for its local Postgres stand-in ('prisma dev') — add "prisma" to your app's devDependencies.`
- `LocalDatabaseProvider()`: `reconcile` (create or artifact-less update):
  run `<prisma-bin> dev --name <instance> --detach`, capture stdout, take the
  LAST non-empty line as the connection URL (the port's proven contract —
  verified against prisma dev v0.16); anything else →
  `Error: could not read the database URL from "prisma dev --name <instance> --detach"; output was: <output>`.
  Record `{ instance, url }` in `postgres.json` keyed by `news.name`. Return
  `{ id: instance, name: news.name }`-shaped attributes mirroring the hosted
  provider's attribute type.
- `LocalConnectionProvider()`: `reconcile` reads `postgres.json` by the
  Database's name (resolved from `news.databaseId` = the instance id) and
  returns `connectionString` = `Redacted.make(url)` matching the hosted
  attribute shape exactly (the postgres/prisma-next descriptors call
  `Redacted.value` on it).
- `PgWarm`/`PnMigration` are NOT here — the hosted ones run as-is.

#### `src/dev/bucket.ts` — local bucket cluster providers

- `LocalBucketProvider()`: `reconcile` ensures `<devDir>/buckets/<name>/`
  exists; returns `{ id: news.name }`-shaped attributes.
- `LocalBucketKeyProvider()`: mint-once-stable like `ServiceKey`: first
  create mints via `@internal/s3-protocol`-style SigV4 pair generation
  (reuse `mintKeyPair()` from the target extension is an upward import —
  instead duplicate the 12-line mint here or move `mintKeyPair` into
  s3-protocol; PIN: move `mintKeyPair` into `@internal/s3-protocol`'s
  `sigv4.ts` and re-export from the extension so both use one impl).
  Attributes: `{ endpoint: \`http://127.0.0.1:${ports.json['s3']}\`,
  bucketName: news.name, accessKeyId, secretAccessKey }` (matching the
  hosted `BucketKey` attribute names the bucket descriptor reads). Register
  the pair in `<devDir>/s3-credentials.json` (mode 0600) — the standIns
  server reads this file at START and on SIGHUP-free simple re-read per
  request is NOT required: converge order guarantees no consumer runs before
  its key exists only across restarts, so PIN: the server re-reads the
  credentials file on each auth failure before rejecting (cheap, closes the
  first-run ordering gap without a watcher).
- `list` → `[]`, `delete` → no-op (objects belong to the developer;
  `--fresh` deletes), `read` → echo output. Both providers.

#### `src/dev/providers.ts`

```ts
export const devProviders = () =>
  Layer.effect(
    Providers,               // the SAME ProviderCollection tag as providers()
    Provider.collection([Project, Database, Connection, ComputeService,
      Deployment, EnvironmentVariable, Bucket, BucketKey]),
  ).pipe(Layer.provide(Layer.mergeAll(
    LocalProjectProvider(), LocalDatabaseProvider(), LocalConnectionProvider(),
    LocalComputeServiceProvider(), LocalDeploymentProvider(),
    LocalEnvironmentVariableProvider(), LocalBucketProvider(),
    LocalBucketKeyProvider(),
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

### 4. Target extension (`packages/1-prisma-cloud/1-extensions/target`)

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
- `src/dev/stand-ins.ts` — `startDevStandIns(input: DevStandInsInput)`:
  allocate `s3` port (dev-store), read/refresh `s3-credentials.json`, start
  `serveS3({ port, store: fsStore(path.join(input.devDir, 'buckets')),
  credentials })`, return `{ stop }`. Started unconditionally (cheap; a
  bucket-less app just has an idle listener).
- `src/dev/teardown.ts` — `runDevTeardown(input: TeardownInput)`:
  1. `<prisma-bin> dev stop 'pcdev-<app>-*'` then
     `<prisma-bin> dev rm 'pcdev-<app>-*'` (glob per the CLI's stop/rm NAME
     pattern support; tolerate nonzero exit when no instance matches — match
     on the CLI's "not found"-style output, otherwise rethrow with output).
  2. `fs.rm` `<cwd>/.prisma-composer/dev` recursively.
  3. `fs.rm` `<cwd>/.alchemy/state/<app>/dev` recursively (the localState
     stage dir; tolerate absence).
- `control/extension.ts` — `prismaCloud()` returns, additionally:

```ts
    dev: {
      container: devContainerDescriptor(),
      providers: () => asProvidersLayer(Layer.mergeAll(
        Prisma.devProviders(),
        PgWarmProvider(),
        PnMigrationProvider(),
        S3CredentialsProvider(),
        Prisma.ServiceKeyProvider(),
      )),
      preflight: (input) => runDevPreflight(input),
      standIns: (input) => startDevStandIns(input),
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

### 5. CLI (`packages/0-framework/3-tooling/cli`)

- `src/main.ts`: new `DevCommand` (`paths = [['dev']]`), options: `entry`
  (positional, required), `--name` (same override semantics as deploy),
  `--fresh` (boolean, default false). `ParsedArgs.command` widens to
  `'deploy' | 'destroy' | 'dev'`. `--stage`/`--production` do not exist on
  dev (clipanion rejects them as unknown flags → usage error).
- `src/dev/` — the dev pipeline + supervisor (all new; `plane: control` via
  the existing CLI glob):
  - `run-dev.ts` — `runDev(args, deps)`:
    1. Steps 1–6 of `run()` reused verbatim (extract the shared prefix of
       `run()` into `src/pipeline.ts` — config discovery/load, entry load,
       Load, coverage validation, name resolution, assemble — so deploy and
       dev cannot drift; `run()` is refactored to consume it).
    2. Dev-capability check: every configured extension has `dev` — else
       `CliError`:
       `extension "<id>" has no local dev support (no \`dev\` descriptor) — remove it from prisma-composer.config.ts or update it.`
    3. `--fresh`: call each extension's `dev.teardown({ container:
       undefined, stage: undefined })` BEFORE container resolution (state may
       be corrupt; teardown must not require it), then continue cold.
    4. Containers: `dev.container.ensure({ appName: name, stage: undefined })`
       per extension.
    5. Preflight: `dev.preflight` per extension (always — dev has no
       deploy/destroy split).
    6. Stand-ins: `dev.standIns({ container, devDir })` per extension;
       collect stops.
    7. Write the dev stack file (below); run
       `runAlchemy({ command: 'deploy', stackFileRelativePath:
       DEV_STACK_RELATIVE_PATH, cwd, stage: 'dev', containerEnv })`.
       Nonzero exit: print the stack-file reproduction hint (deploy's
       pattern, with `--stage dev`) and exit with that status.
    8. Enter the supervisor loop (below) until SIGINT/SIGTERM; on exit stop
       children, stop stand-ins, exit 0.
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
  - `supervisor.ts` — owns children, keyed by `serviceId`:
    - Reconcile pass (after every converge): read the table
      (`readDevProcessTable`); spawn missing; kill+respawn on
      `artifactHash` change; kill children whose record vanished.
    - Spawn: `spawn(bunBin, ['bootstrap.js'], { cwd: record.artifactDir,
      env: record.env, stdio: ['ignore','pipe','pipe'] })`. `bunBin` =
      `bun` resolved on PATH once at startup; missing →
      `CliError: local dev runs services under bun — the Prisma Compute runtime — and \`bun\` was not found on PATH. Install it: https://bun.sh.`
    - Pid registry: `<devDir>/pids.json` (`Record<serviceId, number>`),
      updated on spawn/exit. At startup, for each recorded pid still alive
      whose command line (read via `process.kill(pid, 0)` + platform
      `ps -o command= -p <pid>`) contains `.prisma-composer/dev/artifacts/`,
      SIGTERM it (then SIGKILL after 5s) — recovering from a killed
      supervisor. A pid whose command line does NOT match is left alone and
      dropped from the registry.
    - Logs: line-buffer each child's stdout+stderr; prefix every line
      `[<serviceId>] ` to the dev process's stdout. Supervisor's own lines
      are prefixed `[dev] `.
    - Crash policy: unexpected exit → log
      `[dev] <serviceId> exited (code <code>) — restarting`; restart with
      backoff 1s ·2ⁿ capped 30s, counter reset after 30s of uptime. After 5
      consecutive sub-30s exits, stop restarting and print a standing block:
      the serviceId, last exit code, and the child's last 20 log lines,
      re-printed only when new information arrives; resume on the next
      successful converge that changes its `artifactHash`.
    - Shutdown: SIGTERM each child, 5s grace, SIGKILL survivors; then stand-in
      stops; then exit.
  - `watch.ts` — for each assembled service, watch the **user's built
    output** consumed by assembly: the resolved `entry` file and, when the
    adapter's contract is a directory, the bundle input dir (both are known
    from the build descriptor + assemble result). `fs.watch` recursive on
    dirs, plain on files; debounce 300 ms per burst, coalescing across
    services. On fire: re-run assemble for ALL services (correctness over
    cleverness; optimization is a recorded follow-up) → rewrite the dev stack
    file → re-run converge (`--stage dev`) → reconcile pass. Converge failure
    during watch: print the error, keep the previous processes running, keep
    watching (a broken build must not take down the running topology).
  - Front door, printed after every successful converge:
    `[dev] <address>  <url>` for every record, ordered by address depth
    (fewest dots first) then lexicographic; the first line is preceded by
    `[dev] ready:`.

### 6. `dir()` build adapter (`packages/0-framework/2-authoring/dir/` — NEW)

Prerequisite for the open-chat proof (its runnable is a directory —
friction #3's shape) and independently useful.

- Package `@prisma/composer-dir`? NO — PIN: it ships inside the existing
  node-adapter package as a sibling entry: `packages/0-framework/2-authoring/
  node/src/dir.ts`, public subpath `@prisma/composer/dir` (via `9-public`
  mapping, exactly how `node` is mapped today).
- Authoring surface: `dir({ module: import.meta.url, dir: string, entry:
  string })` — `dir` is the user-built output directory, `entry` the runnable
  file within it, both resolved relative to `dirname(module)` (ADR-0004).
- `assemble()`: validate `dir` exists (else deploy's "run your build" error
  shape), validate `entry` exists inside it, **copy the tree verbatim**
  (`fs.cp recursive`, symlink = hard error with ADR-0005's message shape,
  reusing the walk/validation from `artifact.ts`'s conventions), plus the
  standard wrapper bundling exactly as `node()`'s control does (the wrapper
  `main.mjs` is what `bootstrap.js` imports). Returns
  `{ dir: <workDir>/bundle, entry }`.
- No filename guessing, no tree walking beyond the verbatim copy: the author
  states the directory and the entry (ADR-0005; the friction #3
  recommendation, verbatim).

### 7. Docs & rules

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
  tar reader, watcher, and supervisor use node built-ins only. (`alchemy`,
  `effect`, `clipanion` are already present.)
- **Casts**: `.agents/rules/no-bare-casts.mdc` — every cast is `blindCast`
  with a justification, or real narrowing. The provider attribute shapes are
  typed against the hosted providers' exported types, not re-declared.
- **Values never logged**: secret values, connection URLs (log them
  password-masked exactly as the port's dev.ts did:
  `url.replace(/:[^/:@]*@/, ':***@')`).
- **Determinism**: no `Date.now()`-seeded names or ports; every allocation
  and minted value is persisted and stable across restarts.
- **Windows**: out of scope, recorded: dev requires a POSIX host (the `ps`
  pid check and `prisma dev` both assume it); fail on `process.platform ===
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
