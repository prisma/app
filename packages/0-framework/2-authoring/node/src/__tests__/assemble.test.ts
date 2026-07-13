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
          extension: '@prisma/compose/other',
          type: 'other',
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

  test('rejects an output dir that overlaps the deploy-owned working dir', async () => {
    // dir defaults to the entry's own directory; an entry that resolves inside
    // the address-keyed working dir must be caught before the `rm` that clears
    // that dir on every assemble would delete it out from under itself.
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
    ).rejects.toThrow(/overlaps the deploy working dir/);
  });

  test('ships the entry directory under bundle/, with main.mjs at the working-dir root', async () => {
    const serviceDir = makeServiceDir();
    const cwd = makeCwd();
    const address = 'shop.storefront';
    fs.mkdirSync(path.join(serviceDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(serviceDir, 'dist', 'server.js'), 'export default "app-entry";\n');
    // A sibling in dist/ proves we ship the whole output dir, not just the entry file.
    fs.writeFileSync(path.join(serviceDir, 'dist', 'server.js.map'), '{}\n');
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
    expect(result.entry).toBe('bundle/server.js');
    expect(fs.existsSync(path.join(result.dir, 'bundle', 'server.js'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'bundle', 'server.js.map'))).toBe(true);
    // The wrapper sits at the working-dir root, not under bundle/.
    expect(fs.existsSync(path.join(result.dir, 'main.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'bundle', 'main.mjs'))).toBe(false);
    expect(fs.readFileSync(path.join(result.dir, 'bundle', 'server.js'), 'utf8')).toContain(
      'app-entry',
    );
    // Deploy-owned working dir — never the user's build output, never node_modules.
    expect(result.dir.startsWith(serviceDir)).toBe(false);
    expect(result.dir.includes('node_modules')).toBe(false);
  }, 20_000);

  test('an explicit dir ships a whole tree with a nested entry (the Next standalone shape)', async () => {
    // Next's standalone root holds the hoisted node_modules at its top and the
    // app nested below; the user passes the root as `dir` and the deep server.js
    // path as `entry`, and the returned entry is bundle-prefixed and nested.
    const serviceDir = makeServiceDir();
    const cwd = makeCwd();
    const address = 'storefront.web';
    const appOut = path.join(serviceDir, 'standalone', 'apps', 'web');
    fs.mkdirSync(appOut, { recursive: true });
    fs.writeFileSync(path.join(appOut, 'server.js'), 'export default "app-entry";\n');
    fs.mkdirSync(path.join(serviceDir, 'standalone', 'node_modules', 'next'), { recursive: true });
    fs.writeFileSync(
      path.join(serviceDir, 'standalone', 'node_modules', 'next', 'x.js'),
      'export {};\n',
    );
    fs.writeFileSync(
      path.join(serviceDir, 'src', 'service.ts'),
      'export default { hello: "wrapper" as const };\n',
    );

    const result = await assemble({
      build: {
        extension: '@prisma/compose/node',
        type: 'node',
        module: moduleUrl(serviceDir),
        dir: '../standalone',
        entry: '../standalone/apps/web/server.js',
      },
      address,
      cwd,
    });

    expect(result.entry).toBe('bundle/apps/web/server.js');
    expect(fs.existsSync(path.join(result.dir, 'main.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'bundle', 'apps', 'web', 'server.js'))).toBe(true);
    // The whole dir shipped — including the hoisted node_modules above the entry.
    expect(fs.existsSync(path.join(result.dir, 'bundle', 'node_modules', 'next', 'x.js'))).toBe(
      true,
    );
  }, 20_000);
});
