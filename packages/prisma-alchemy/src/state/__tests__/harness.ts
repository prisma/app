import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface TestPostgres {
  readonly url: string;
  readonly stop: () => void;
}

// Some sandboxes leave LANG/LC_* unset or pointed at a locale glibc/ICU
// can't resolve, which makes `postmaster` become multithreaded during
// startup and immediately refuse to serve ("postmaster became
// multithreaded during startup", hint: set LC_ALL). Pin C for every
// initdb/pg_ctl invocation so the cluster starts the same way everywhere.
const PG_ENV = { ...process.env, LC_ALL: 'C', LANG: 'C' };

const probe = (bin: string): boolean =>
  spawnSync(bin, ['--version'], { stdio: 'ignore', env: PG_ENV }).status === 0;

const findBinary = (name: string): string | undefined => {
  const candidates = [
    name,
    `/opt/homebrew/opt/postgresql@15/bin/${name}`,
    `/opt/homebrew/bin/${name}`,
    `/usr/local/opt/postgresql@15/bin/${name}`,
    `/usr/local/bin/${name}`,
  ];
  return candidates.find(probe);
};

/**
 * Synchronously starts (or reuses) a throwaway Postgres for the state-store
 * tests. Runs at module load — before `describe.skipIf` gates the suite —
 * because bun collects tests synchronously, so availability must be known
 * before the file finishes registering its `describe` blocks.
 *
 * Resolution order:
 * 1. `STATE_TEST_DATABASE_URL` — a pre-existing Postgres (e.g. a CI service
 *    container). Used as-is; `stop()` is a no-op since this harness didn't
 *    start it.
 * 2. `initdb` + `pg_ctl` on PATH (or common Homebrew locations) — spins an
 *    ephemeral cluster under `STATE_TEST_PG_TMPDIR` (falls back to the OS
 *    temp dir) on a random high port, and tears it down in `stop()`.
 *
 * Returns `undefined` when neither is available. Callers must skip loudly —
 * never silently pass — when this returns `undefined`.
 */
export const startTestPostgres = (): TestPostgres | undefined => {
  const fromEnv = process.env['STATE_TEST_DATABASE_URL'];
  if (fromEnv !== undefined) {
    return { url: fromEnv, stop: () => {} };
  }

  const initdb = findBinary('initdb');
  const pgCtl = findBinary('pg_ctl');
  if (initdb === undefined || pgCtl === undefined) return undefined;

  const baseDir = process.env['STATE_TEST_PG_TMPDIR'] ?? os.tmpdir();
  fs.mkdirSync(baseDir, { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(baseDir, 'makerkit-state-pg-'));
  const logFile = path.join(dataDir, 'server.log');

  execFileSync(
    initdb,
    ['-D', dataDir, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C'],
    {
      stdio: 'pipe',
      env: PG_ENV,
    },
  );

  let lastError = 'unknown error';
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const result = spawnSync(
      pgCtl,
      ['-D', dataDir, '-o', `-p ${port} -h 127.0.0.1`, '-w', '-l', logFile, 'start'],
      { stdio: 'pipe', env: PG_ENV },
    );
    if (result.status === 0) {
      return {
        url: `postgres://postgres@127.0.0.1:${port}/postgres`,
        stop: () => {
          try {
            execFileSync(pgCtl, ['-D', dataDir, '-m', 'fast', 'stop'], {
              stdio: 'pipe',
              env: PG_ENV,
            });
          } finally {
            fs.rmSync(dataDir, { recursive: true, force: true });
          }
        },
      };
    }
    lastError = result.stderr.toString();
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
  throw new Error(
    `initdb/pg_ctl were found on PATH but the ephemeral test Postgres failed to start after 5 attempts: ${lastError}`,
  );
};
