import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assemble } from '../control.ts';

const tmpDirs: string[] = [];

/** A tmp dir standing in for a service package: src/service.ts + a dist/ sibling. */
function makeServiceDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-compose-node-assemble-'));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  return dir;
}

/** A tmp dir standing in for the deploy CLI's cwd — kept separate from the service package so staging-location assertions can't pass by accident. */
function makeCwd(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-compose-node-assemble-cwd-'));
  tmpDirs.push(dir);
  return dir;
}

/** The authoring module's import.meta.url for a service dir's src/service.ts (need not exist on disk unless the test writes it). */
function moduleUrl(serviceDir: string): string {
  return pathToFileURL(path.join(serviceDir, 'src', 'service.ts')).href;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('assemble()', () => {
  test('rejects a non-node build adapter', async () => {
    const serviceDir = makeServiceDir();
    await expect(
      assemble({
        build: {
          extension: '@prisma/compose/nextjs',
          type: 'nextjs',
          module: moduleUrl(serviceDir),
          entry: 'server.js',
        },
        address: 'svc',
        cwd: makeCwd(),
      }),
    ).rejects.toThrow(/expected a "node" build adapter/);
  });

  test('rejects when the declared build entry is missing — names the expected path', async () => {
    const serviceDir = makeServiceDir();
    await expect(
      assemble({
        build: {
          extension: '@prisma/compose/node',
          type: 'node',
          module: moduleUrl(serviceDir),
          entry: '../dist/server.js',
        },
        address: 'svc',
        cwd: makeCwd(),
      }),
    ).rejects.toThrow(/no built entry at .*dist\/server\.js/);
  });

  test('rejects an app entry named main.js — reserved for the wrapper', async () => {
    const serviceDir = makeServiceDir();
    fs.mkdirSync(path.join(serviceDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(serviceDir, 'dist', 'main.js'), 'export {};\n');
    await expect(
      assemble({
        build: {
          extension: '@prisma/compose/node',
          type: 'node',
          module: moduleUrl(serviceDir),
          entry: '../dist/main.js',
        },
        address: 'svc',
        cwd: makeCwd(),
      }),
    ).rejects.toThrow(/reserved for the Prisma App wrapper/);
  });

  test('rejects an entry that resolves inside the deploy-owned working dir', async () => {
    // The working dir is address-keyed under cwd, independent of the entry's
    // own location — an entry that happens to resolve inside it must be caught
    // before the `rm` that clears the working dir on every assemble would
    // delete it out from under itself.
    const cwd = makeCwd();
    const address = 'svc';
    const workDir = path.join(cwd, '.prisma-compose', 'artifacts', address);
    fs.mkdirSync(path.join(workDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(workDir, 'server.js'), 'export default "app-entry";\n');
    await expect(
      assemble({
        build: {
          extension: '@prisma/compose/node',
          type: 'node',
          module: pathToFileURL(path.join(workDir, 'src', 'service.ts')).href,
          entry: '../server.js',
        },
        address,
        cwd,
      }),
    ).rejects.toThrow(/resolves inside the deploy staging dir/);
  });

  test('produces a working dir with main.mjs at root and the built entry under bundle/', async () => {
    const serviceDir = makeServiceDir();
    const cwd = makeCwd();
    const address = 'shop.storefront';
    fs.mkdirSync(path.join(serviceDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(serviceDir, 'dist', 'server.js'), 'export default "app-entry";\n');
    fs.writeFileSync(
      path.join(serviceDir, 'src', 'service.ts'),
      'export default { hello: "wrapper" as const };\n',
    );

    const result = await assemble({
      build: {
        extension: '@prisma/compose/node',
        type: 'node',
        module: moduleUrl(serviceDir),
        entry: '../dist/server.js',
      },
      address,
      cwd,
    });

    expect(result.dir).toBe(path.join(cwd, '.prisma-compose', 'artifacts', address));
    // The user's entry lives under bundle/; the returned entry is bundle-prefixed.
    expect(result.entry).toBe('bundle/server.js');
    expect(fs.existsSync(path.join(result.dir, 'bundle', 'server.js'))).toBe(true);
    // The wrapper sits at the working-dir root, not under bundle/.
    expect(fs.existsSync(path.join(result.dir, 'main.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'bundle', 'main.mjs'))).toBe(false);
    // The copied entry is untouched — same module instance as the user's build.
    expect(fs.readFileSync(path.join(result.dir, 'bundle', 'server.js'), 'utf8')).toContain(
      'app-entry',
    );
    // The working dir is deploy-owned — never the user's build output, never node_modules.
    expect(result.dir.startsWith(serviceDir)).toBe(false);
    expect(result.dir.includes('node_modules')).toBe(false);
  }, 20_000);

  test('assembles a build whose module basename is not "service" (cron scheduler shape) to main.mjs, entry under bundle/', async () => {
    // The cron scheduler's build.module is "scheduler-service.mjs", not
    // "service.ts" — a filename-discovery approach (readdir + regex on
    // "service.*") would miss it; the tsdown object entry must not care what
    // the module is named.
    const serviceDir = makeServiceDir();
    const cwd = makeCwd();
    const address = 'jobs.scheduler';
    fs.mkdirSync(path.join(serviceDir, 'dist'), { recursive: true });
    fs.writeFileSync(
      path.join(serviceDir, 'dist', 'scheduler-entrypoint.js'),
      'export default "app-entry";\n',
    );
    fs.writeFileSync(
      path.join(serviceDir, 'src', 'scheduler-service.ts'),
      'export default { hello: "wrapper" as const };\n',
    );

    const result = await assemble({
      build: {
        extension: '@prisma/compose/node',
        type: 'node',
        module: pathToFileURL(path.join(serviceDir, 'src', 'scheduler-service.ts')).href,
        entry: '../dist/scheduler-entrypoint.js',
      },
      address,
      cwd,
    });

    const expectedDir = path.join(cwd, '.prisma-compose', 'artifacts', address);
    expect(result.dir).toBe(expectedDir);
    expect(result.entry).toBe('bundle/scheduler-entrypoint.js');
    expect(fs.existsSync(path.join(result.dir, 'main.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'bundle', 'scheduler-entrypoint.js'))).toBe(true);
    expect(result.dir.startsWith(serviceDir)).toBe(false);
    expect(result.dir.includes('node_modules')).toBe(false);
  }, 20_000);
});
