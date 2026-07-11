/**
 * Proves the CLI's entry-anchored module resolution (packages/app-cli/
 * src/resolve-from-entry.ts) against REAL target/adapter packs — not
 * fixtures. This cannot live in packages/app-cli's own suite: the CLI
 * itself must not depend on any specific pack (see test/README.md), but this
 * package genuinely does, so `prisma-app deploy` here resolves
 * `@prisma/app-cloud/target` and `@prisma/app-node/assemble` for real.
 *
 * Drives the CLI as a binary (`node_modules/.bin/prisma-app`) under `node` — the
 * CLI's own `#!/usr/bin/env node` shebang runtime — rather than importing its
 * internals. (Spawning the compiled bin under `bun` hits a bun module-cache
 * quirk on Linux when a second CLI subprocess resolves the same dist-exporting
 * workspace packages; `node` is the published runtime and resolves them cleanly.)
 */
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const integrationDir = path.resolve(import.meta.dir, '..');
const prismaAppBin = path.join(integrationDir, 'node_modules', '.bin', 'prisma-app');
const fixtureEntry = path.join(integrationDir, 'test', 'fixtures', 'entry-anchored', 'service.ts');

describe('prisma-app deploy — real entry-anchored resolution of prisma-cloud + node', () => {
  test('resolves both packs for real and fails at the missing built entry, not at resolution', () => {
    const result = spawnSync('node', [prismaAppBin, 'deploy', fixtureEntry], {
      cwd: integrationDir,
      encoding: 'utf8',
      env: { ...process.env, PRISMA_WORKSPACE_ID: 'ws-integration-test' },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain('Cannot resolve');
    expect(result.stderr).not.toContain('environment variable PRISMA_WORKSPACE_ID is required');
    expect(result.stderr).toContain('no built entry at');
    expect(result.stderr).toContain("run this app's own build first");
  });

  test('without PRISMA_WORKSPACE_ID, fails at the real prisma-cloud fromEnv() check — proving the /target entry actually resolved and ran', () => {
    const env = { ...process.env };
    delete env['PRISMA_WORKSPACE_ID'];

    const result = spawnSync('node', [prismaAppBin, 'deploy', fixtureEntry], {
      cwd: integrationDir,
      encoding: 'utf8',
      env,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain('Cannot resolve');
    expect(result.stderr).toContain('environment variable PRISMA_WORKSPACE_ID is required');
  });
});
