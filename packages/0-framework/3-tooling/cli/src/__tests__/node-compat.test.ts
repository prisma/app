/**
 * The CLI must run under node (>= 22.18, default type stripping) as well as
 * bun (design-notes.md's "CLI runtime" call). This is the one test in the
 * suite that actually spawns a separate node process, proving `bin.ts`
 * itself — not just its pieces — works there.
 *
 * Each case gets a generous timeout: a cold `node bin.ts` type-strips and loads
 * the whole CLI graph (effect, alchemy, every adapter), which runs 5-6s on a
 * slow CI runner — past bun test's 5s default. `spawnSync` is synchronous, so
 * bun can't interrupt it; it only fails the test *after* the call returns, i.e.
 * a slow-but-correct run flakes red. The wide timeout removes that race.
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const binPath = path.join(import.meta.dir, '..', 'bin.ts');
const SPAWN_TIMEOUT_MS = 30_000;

describe('node compatibility smoke test', () => {
  test(
    'a bare invocation under node prints usage (deploy and destroy) and exits nonzero',
    () => {
      const result = spawnSync('node', [binPath], { encoding: 'utf8' });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('prisma-composer deploy');
      expect(result.stderr).toContain('prisma-composer destroy');
      expect(result.stderr).toContain('<entry>');
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    'an unknown command under node prints usage and exits nonzero',
    () => {
      const result = spawnSync('node', [binPath, 'build', 'src/service.ts'], { encoding: 'utf8' });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('prisma-composer deploy');
      expect(result.stderr).toContain('prisma-composer destroy');
    },
    SPAWN_TIMEOUT_MS,
  );
});
