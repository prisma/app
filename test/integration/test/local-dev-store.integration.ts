/**
 * The plan-S5 proving script (plan.md's S5 outcome; local-dev spec's
 * acceptance criteria 1, 3, 6): drives the REAL, published `prisma-composer`
 * binary — `examples/store/node_modules/.bin/prisma-composer` — as a real
 * child process against `examples/store`, a real multi-module app (four
 * services, two Postgres-backed modules, cron), exactly as an operator would
 * run it. Every other integration script in this package drives the
 * pipeline's own functions directly; this one is deliberately at arm's
 * length — the CLI's argv parsing, its own SIGINT handling, and its own
 * process lifetime are themselves what's under test.
 *
 * Criteria proved here:
 *   1. Credential-free bring-up: PRISMA_WORKSPACE_ID/PRISMA_SERVICE_TOKEN/
 *      PRISMA_REGION are stripped from the child's env; the front door
 *      (`[dev] ready:` + one line per service) is parsed from real stdout;
 *      an HTTP round-trip against the storefront's URL succeeds.
 *   3. Postgres persistence: a row is written directly against the real
 *      `prisma dev` URL (read from `.prisma-composer/dev/postgres.json`,
 *      never through the app's own RPC surface — this is a storage-layer
 *      proof, not a business-logic one) before Ctrl-C; a second `dev` start
 *      reads it back (warm); `--fresh` wipes it.
 *   6. Warm restart: the second start's front-door ports match the first's
 *      exactly — no re-provisioning.
 *
 * Not proved here (see the S5 report): criterion 2 (rebuild restarts one
 * service) needs `Bundle.watch`, which isn't on this branch (S2, a sibling
 * slice — see spec.md's Open Questions); criteria 4/5 (bucket, placeholder/
 * env-param) are proved against the S4 fixture instead — store declares
 * neither a bucket nor a secret/env-param.
 *
 * WHY THIS IS A STANDALONE SCRIPT, NOT bun:test: same reasoning as
 * local-dev.integration.ts — a nested `prisma dev --detach` grandchild's
 * stdout is unreliable under `bun test`'s own process tree. Invoked by
 * package.json's `test` script as a second `bun run` step.
 */

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) {
    throw new Error(
      `assertion failed: ${message}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
  }
}

const integrationDir = path.resolve(import.meta.dir, '..');
const repoRoot = path.resolve(integrationDir, '..', '..');
const storeDir = path.join(repoRoot, 'examples', 'store');
const devDir = path.join(storeDir, '.prisma-composer', 'dev');
// Deliberately OUTSIDE `.prisma-composer/dev` — `--fresh` recursively
// removes that whole directory (runDevTeardown), which would delete these
// logs mid-run otherwise.
const logDir = path.join(integrationDir, '.local-dev-store-proving-logs');
const CLI_BIN = path.join(storeDir, 'node_modules', '.bin', 'prisma-composer');
const READY_TIMEOUT_MS = 90_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;

let sessionCount = 0;

interface Endpoint {
  readonly address: string;
  readonly url: string;
}

interface DevSession {
  readonly child: ChildProcess;
  readonly logPath: string;
  readonly endpoints: readonly Endpoint[];
}

function credentialFreeEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env['PRISMA_WORKSPACE_ID'];
  delete env['PRISMA_SERVICE_TOKEN'];
  delete env['PRISMA_REGION'];
  return env;
}

function readLog(logPath: string): string {
  try {
    return fs.readFileSync(logPath, 'utf8');
  } catch {
    return '';
  }
}

/** Parses the pinned front-door block out of the tee'd log: `[dev] ready:` then `[dev] <address>  <url>` lines, until a non-matching line. */
function parseFrontDoor(log: string): readonly Endpoint[] | undefined {
  const lines = log.split('\n');
  const readyAt = lines.findIndex((l) => l.trim() === '[dev] ready:');
  if (readyAt === -1) return undefined;
  const endpoints: Endpoint[] = [];
  for (let i = readyAt + 1; i < lines.length; i += 1) {
    const m = /^\[dev\] (\S+)\s\s(\S+)$/.exec(lines[i] ?? '');
    if (m === null) break;
    endpoints.push({ address: m[1] as string, url: m[2] as string });
  }
  return endpoints.length > 0 ? endpoints : undefined;
}

async function waitForAsync<T>(
  fn: () => Promise<T | undefined>,
  timeoutMs: number,
  intervalMs = 250,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const result = await fn();
      if (result !== undefined) return result;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      throw lastError instanceof Error
        ? lastError
        : new Error(`waitFor: not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Starts `prisma-composer dev module.ts [--fresh]` as a real, teed child
 * process (stdout/stderr appended to a log FILE by raw fd — the same reason
 * local-dev.integration.ts avoids piped capture: nested grandchildren losing
 * output under some parent process trees). Bounded: the ready-wait itself is
 * the hang guard — nothing here can wait forever.
 */
async function startDev(fresh: boolean): Promise<DevSession> {
  sessionCount += 1;
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, `session-${sessionCount}.log`);
  const logFd = fs.openSync(logPath, 'w');
  const args = ['dev', 'module.ts', ...(fresh ? ['--fresh'] : [])];
  const child = spawn(CLI_BIN, args, {
    cwd: storeDir,
    env: credentialFreeEnv(),
    stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd);

  child.on('exit', (code, signal) => {
    // Visible in the log for post-mortem; the log file itself already
    // records everything the process printed before this.
    console.log(
      `[proving] session ${sessionCount} exited (code=${String(code)} signal=${String(signal)})`,
    );
  });

  const endpoints = await waitForAsync(
    async () => parseFrontDoor(readLog(logPath)),
    READY_TIMEOUT_MS,
    500,
  );
  return { child, logPath, endpoints };
}

/** SIGINT, then wait for the process to actually exit (bounded) — the pinned Ctrl-C contract: stop, exit 0, emulators survive. */
async function stopDev(session: DevSession): Promise<void> {
  if (session.child.exitCode !== null || session.child.signalCode !== null) return;
  session.child.kill('SIGINT');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`session did not exit within ${SHUTDOWN_TIMEOUT_MS}ms of SIGINT`));
    }, SHUTDOWN_TIMEOUT_MS);
    session.child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

interface PostgresEntry {
  readonly instance: string;
  readonly url: string;
}

function readCatalogDbUrl(): string {
  const postgres = readJson(path.join(devDir, 'postgres.json')) as Record<string, PostgresEntry>;
  const entry = postgres['pcdev-store-catalog-database'];
  assert(entry?.url !== undefined, 'postgres.json must have a pcdev-store-catalog-database entry');
  return entry.url;
}

/** Runs `bun`'s built-in SQL client against the real local Postgres URL — the storage layer, never the app's own RPC. */
async function withSql<T>(url: string, fn: (sql: Bun.SQL) => Promise<T>): Promise<T> {
  const sql = new Bun.SQL(url);
  try {
    return await fn(sql);
  } finally {
    await sql.close();
  }
}

const PROVING_PRODUCT_ID = 'proving-row';

async function main(): Promise<void> {
  console.log('local dev (S5 proving): examples/store via the real prisma-composer dev binary');

  fs.rmSync(path.join(storeDir, '.prisma-composer'), { recursive: true, force: true });
  fs.rmSync(path.join(storeDir, '.alchemy'), { recursive: true, force: true });

  let session: DevSession | undefined;
  try {
    // ——— Criterion 1: credential-free bring-up + HTTP round-trip ———
    session = await startDev(false);
    console.log(`[proving] session 1 ready: ${JSON.stringify(session.endpoints)}`);
    assert(
      session.endpoints.some((e) => e.address === 'storefront'),
      'the front door must list the storefront service',
    );
    const storefront = session.endpoints.find((e) => e.address === 'storefront');
    if (storefront === undefined) throw new Error('unreachable');
    const health = await waitForAsync(
      () => fetch(storefront.url).then((r) => (r.ok ? r : undefined)),
      15_000,
    );
    assertEqual(health.status, 200, 'the storefront HTTP round-trip');
    console.log('[proving] PASS criterion 1: credential-free bring-up + HTTP round-trip');

    const firstPortsByAddress = Object.fromEntries(
      session.endpoints.map((e) => [e.address, new URL(e.url).port]),
    );

    // ——— Criterion 3 (write half): a row through the real local Postgres URL ———
    const dbUrl = readCatalogDbUrl();
    await withSql(dbUrl, async (sql) => {
      // prisma-next's migration DDL folds the table name and single-word
      // columns to lowercase (unquoted identifiers); "priceCents" alone
      // stays quoted, mixed-case.
      await sql`insert into product (id, name, description, "priceCents")
                values (${PROVING_PRODUCT_ID}, 'Proving Row', 'S5 proving script', 100)
                on conflict (id) do update set name = excluded.name`;
    });
    console.log('[proving] wrote the proving row through the real local Postgres URL');

    // ——— Ctrl-C ———
    await stopDev(session);
    console.log('[proving] session 1 stopped cleanly on SIGINT');

    // ——— Criterion 3 (warm read) + criterion 6 (same ports) ———
    session = await startDev(false);
    console.log(`[proving] session 2 (warm) ready: ${JSON.stringify(session.endpoints)}`);
    const secondPortsByAddress = Object.fromEntries(
      session.endpoints.map((e) => [e.address, new URL(e.url).port]),
    );
    assertEqual(
      secondPortsByAddress,
      firstPortsByAddress,
      'criterion 6: warm restart keeps the same ports',
    );

    const warmDbUrl = readCatalogDbUrl();
    assertEqual(warmDbUrl, dbUrl, 'criterion 6: the Postgres URL is stable across a warm restart');
    const warmRow = await withSql(
      warmDbUrl,
      (sql) => sql`select name from product where id = ${PROVING_PRODUCT_ID}`,
    );
    assertEqual(
      (warmRow as unknown as { name: string }[])[0]?.name,
      'Proving Row',
      'criterion 3: the row survives a warm (non---fresh) restart',
    );
    console.log('[proving] PASS criterion 3 (warm): row survived a Ctrl-C restart');
    console.log('[proving] PASS criterion 6: same ports, no re-provisioning across a warm restart');

    await stopDev(session);
    console.log('[proving] session 2 stopped cleanly on SIGINT');

    // ——— Criterion 3 (--fresh half): the instance and its data are gone ———
    session = await startDev(true);
    console.log(`[proving] session 3 (--fresh) ready: ${JSON.stringify(session.endpoints)}`);
    const freshDbUrl = readCatalogDbUrl();
    // --fresh removes the whole prisma dev instance (prisma dev rm) and
    // recreates it on next provision — migrations reapply as part of THIS
    // SAME converge (PnMigration runs on every converge), so the "product"
    // table exists again by the time the front door prints; the proof is
    // that it's freshly migrated and EMPTY — the proving row from before
    // --fresh is gone.
    const freshRow = await withSql(
      freshDbUrl,
      (sql) => sql`select name from product where id = ${PROVING_PRODUCT_ID}`,
    );
    assertEqual(
      (freshRow as unknown as { name: string }[]).length,
      0,
      'criterion 3 (--fresh): the proving row must be gone from a fresh instance',
    );
    console.log('[proving] PASS criterion 3 (--fresh): the prior instance and its data are gone');

    console.log('PASS: local dev (S5 proving) — examples/store, criteria 1/3/6');
  } finally {
    if (session !== undefined) {
      await stopDev(session).catch(() => undefined);
    }
    // Final app-scoped teardown, mirroring local-dev.integration.ts: never
    // touch the machine-global emulator daemons, only this app's own
    // records — `--fresh` then Ctrl-C leaves nothing running and no data
    // behind for the next run.
    try {
      const cleanup = await startDev(true);
      await stopDev(cleanup);
    } catch (error) {
      console.error(
        `[proving] final --fresh cleanup did not complete cleanly: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const stray = spawnSync('pgrep', ['-f', 'prisma-composer dev module.ts']);
    for (const line of (stray.stdout?.toString() ?? '').split('\n')) {
      const pid = Number(line.trim());
      if (Number.isFinite(pid) && pid > 0) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    }
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
