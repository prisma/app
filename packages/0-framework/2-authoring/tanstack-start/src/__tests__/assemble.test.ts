import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assembleTanStackStart, tanstackStartBuild } from '../control.ts';
import tanstackStart from '../index.ts';

const tmpDirs: string[] = [];

function makeAppRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-composer-tanstack-start-'));
  tmpDirs.push(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  return root;
}

function makeCwd(): string {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-composer-tanstack-start-cwd-'));
  tmpDirs.push(cwd);
  return cwd;
}

function moduleUrl(root: string): string {
  return pathToFileURL(path.join(root, 'src', 'service.ts')).href;
}

function writeServiceModule(root: string): void {
  fs.writeFileSync(
    path.join(root, 'src', 'service.ts'),
    'export default { hello: "wrapper" as const };\n',
  );
}

function writeNitroBuild(
  root: string,
  options: { preset?: string; serverEntry?: string } = {},
): void {
  const output = path.join(root, '.output');
  const serverEntry = options.serverEntry ?? 'server/custom-entry.mjs';
  fs.mkdirSync(path.dirname(path.join(output, serverEntry)), { recursive: true });
  fs.writeFileSync(path.join(output, serverEntry), '// Nitro server entry\n');
  fs.mkdirSync(path.join(output, 'server', '_chunks'), { recursive: true });
  fs.writeFileSync(path.join(output, 'server', '_chunks', 'runtime.mjs'), '// sibling chunk\n');
  fs.mkdirSync(path.join(output, 'public'), { recursive: true });
  fs.writeFileSync(path.join(output, 'public', 'composer.txt'), 'public asset\n');
  fs.writeFileSync(
    path.join(output, 'nitro.json'),
    JSON.stringify({
      preset: options.preset ?? 'node-server',
      serverEntry,
      publicDir: 'public',
    }),
  );
  writeServiceModule(root);
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('assemble()', () => {
  test('rejects a non-TanStack Start descriptor', async () => {
    const root = makeAppRoot();
    await expect(
      assembleTanStackStart({
        address: 'web',
        cwd: makeCwd(),
        build: {
          extension: '@prisma/composer/node',
          type: 'node',
          module: moduleUrl(root),
          entry: 'server.mjs',
        },
      }),
    ).rejects.toThrow(/expected a "tanstack-start" build adapter/);
  });

  test('rejects a missing build with an actionable Vite command', async () => {
    const root = makeAppRoot();
    await expect(
      assembleTanStackStart({
        address: 'web',
        cwd: makeCwd(),
        build: tanstackStart({ module: moduleUrl(root), appDir: '..' }),
      }),
    ).rejects.toThrow(/no TanStack Start build manifest at .*\.output.* run `vite build`/);
  });

  test('rejects malformed nitro.json', async () => {
    const root = makeAppRoot();
    fs.mkdirSync(path.join(root, '.output'), { recursive: true });
    fs.writeFileSync(path.join(root, '.output', 'nitro.json'), '{ not json');

    await expect(
      assembleTanStackStart({
        address: 'web',
        cwd: makeCwd(),
        build: tanstackStart({ module: moduleUrl(root), appDir: '..' }),
      }),
    ).rejects.toThrow(/invalid Nitro build manifest/);
  });

  test('rejects a Nitro preset that is not node-server', async () => {
    const root = makeAppRoot();
    writeNitroBuild(root, { preset: 'cloudflare-module' });

    await expect(
      assembleTanStackStart({
        address: 'web',
        cwd: makeCwd(),
        build: tanstackStart({ module: moduleUrl(root), appDir: '..' }),
      }),
    ).rejects.toThrow(/requires Nitro's "node-server" preset/);
  });

  test('rejects a manifest without a serverEntry', async () => {
    const root = makeAppRoot();
    const output = path.join(root, '.output');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'nitro.json'), JSON.stringify({ preset: 'node-server' }));

    await expect(
      assembleTanStackStart({
        address: 'web',
        cwd: makeCwd(),
        build: tanstackStart({ module: moduleUrl(root), appDir: '..' }),
      }),
    ).rejects.toThrow(/records no serverEntry/);
  });

  test('reads the server entry from Nitro and assembles the complete output tree', async () => {
    const root = makeAppRoot();
    const cwd = makeCwd();
    writeNitroBuild(root);

    const result = await assembleTanStackStart({
      address: 'app.web',
      cwd,
      build: tanstackStart({ module: moduleUrl(root), appDir: '..' }),
    });

    expect(result.dir).toBe(path.join(cwd, '.prisma-composer', 'artifacts', 'app.web'));
    expect(result.entry).toBe('bundle/server/custom-entry.mjs');
    expect(fs.existsSync(path.join(result.dir, 'main.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'bundle', 'nitro.json'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'bundle', 'server', '_chunks', 'runtime.mjs'))).toBe(
      true,
    );
    expect(fs.readFileSync(path.join(result.dir, 'bundle', 'public', 'composer.txt'), 'utf8')).toBe(
      'public asset\n',
    );
  }, 20_000);

  test('rejects a manifest entry that escapes the Nitro output directory', async () => {
    const root = makeAppRoot();
    const output = path.join(root, '.output');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(
      path.join(output, 'nitro.json'),
      JSON.stringify({ preset: 'node-server', serverEntry: '../outside.mjs' }),
    );
    fs.writeFileSync(path.join(root, 'outside.mjs'), '// outside\n');
    writeServiceModule(root);

    await expect(
      assembleTanStackStart({
        address: 'web',
        cwd: makeCwd(),
        build: tanstackStart({ module: moduleUrl(root), appDir: '..' }),
      }),
    ).rejects.toThrow(/not inside dir/);
  });
});

describe('tanstackStartBuild()', () => {
  test('registers the TanStack Start assembler under its descriptor key', () => {
    const extension = tanstackStartBuild();
    expect(extension.id).toBe('@prisma/composer/tanstack-start');
    expect(extension.nodes['tanstack-start']).toEqual({
      kind: 'build',
      assemble: assembleTanStackStart,
    });
  });
});
