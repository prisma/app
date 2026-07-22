import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import dir from '../exports/dir.ts';
import { assemble } from '../exports/dir-control.ts';

const tmpDirs: string[] = [];

/** A tmp dir standing in for a service package: src/service.ts + a dist/ sibling. */
function makeServiceDir(): string {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-composer-dir-assemble-'));
  tmpDirs.push(dirPath);
  fs.mkdirSync(path.join(dirPath, 'src'), { recursive: true });
  return dirPath;
}

/** A tmp dir standing in for the deploy CLI's cwd — kept separate from the service package so staging-location assertions can't pass by accident. */
function makeCwd(): string {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'prisma-composer-dir-assemble-cwd-'));
  tmpDirs.push(dirPath);
  return dirPath;
}

/** The authoring module's import.meta.url for a service dir's src/service.ts. */
function moduleUrl(serviceDir: string): string {
  return pathToFileURL(path.join(serviceDir, 'src', 'service.ts')).href;
}

/** The service module the wrapper is built from — every assemble that gets past validation bundles this. */
function writeServiceModule(serviceDir: string): void {
  fs.writeFileSync(
    path.join(serviceDir, 'src', 'service.ts'),
    'export default { hello: "wrapper" as const };\n',
  );
}

/** Writes `files` (paths relative to `dirPath`, POSIX-separated) under `dirPath`, creating parents. */
function writeTree(dirPath: string, files: Record<string, string>): string {
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(dirPath, ...rel.split('/'));
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, contents);
  }
  return dirPath;
}

/** Every file inside `dirPath`, as POSIX-separated paths relative to it — sorted, so a copy's contents can be asserted exactly. */
function treeContents(dirPath: string): string[] {
  return fs
    .readdirSync(dirPath, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(dirPath, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'),
    )
    .sort();
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dirPath = tmpDirs.pop();
    if (dirPath !== undefined) fs.rmSync(dirPath, { recursive: true, force: true });
  }
});

describe('assemble() — the dir() adapter', () => {
  test('rejects a non-dir build adapter', async () => {
    const serviceDir = makeServiceDir();
    await expect(
      assemble({
        build: {
          extension: '@prisma/composer/node',
          type: 'node',
          module: moduleUrl(serviceDir),
          entry: 'server.js',
        },
        address: 'svc',
        cwd: makeCwd(),
      }),
    ).rejects.toThrow(/expected a "dir" build adapter/);
  });

  test('copies the whole tree verbatim under bundle/ and boots the named entry — the tree arrives byte-identical', async () => {
    const serviceDir = makeServiceDir();
    const cwd = makeCwd();
    const logo = 'PNG binary-ish bytes';
    writeTree(path.join(serviceDir, 'dist', 'server'), {
      'start.js': 'export default "app-entry";\n',
      'index.html': '<link rel="stylesheet" href="/assets/app.css">\n',
      'assets/app.css': 'body { color: red }\n',
      'assets/logo.png': logo,
      'nested/deep/marker.txt': 'deep file\n',
    });
    writeServiceModule(serviceDir);

    const result = await assemble({
      build: dir({ module: moduleUrl(serviceDir), dir: '../dist/server', entry: 'start.js' }),
      address: 'chat.web',
      cwd,
    });

    expect(result.dir).toBe(path.join(cwd, '.prisma-composer', 'artifacts', 'chat.web'));
    expect(result.entry).toBe('bundle/start.js');
    expect(treeContents(path.join(result.dir, 'bundle'))).toEqual([
      'assets/app.css',
      'assets/logo.png',
      'index.html',
      'nested/deep/marker.txt',
      'start.js',
    ]);
    expect(fs.readFileSync(path.join(result.dir, 'bundle', 'assets', 'logo.png'), 'utf8')).toBe(
      logo,
    );
    // The wrapper sits at the working-dir root, outside the copied tree.
    expect(fs.existsSync(path.join(result.dir, 'main.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'bundle', 'main.mjs'))).toBe(false);
    // Bundle.watch names the resolved input dir — the whole tree is watched (ADR-0041).
    expect(result.watch).toEqual([path.join(serviceDir, 'dist', 'server')]);
  }, 20_000);

  test('boots an entry nested inside the tree, reported relative to bundle/', async () => {
    const serviceDir = makeServiceDir();
    const cwd = makeCwd();
    writeTree(path.join(serviceDir, 'dist', 'app'), {
      'server/start.js': 'export default "app-entry";\n',
      'client/main.js': 'console.log("client");\n',
    });
    writeServiceModule(serviceDir);

    const result = await assemble({
      build: dir({ module: moduleUrl(serviceDir), dir: '../dist/app', entry: 'server/start.js' }),
      address: 'svc',
      cwd,
    });

    expect(result.entry).toBe('bundle/server/start.js');
    expect(fs.existsSync(path.join(result.dir, 'bundle', 'server', 'start.js'))).toBe(true);
    expect(fs.existsSync(path.join(result.dir, 'bundle', 'client', 'main.js'))).toBe(true);
  }, 20_000);

  test('rejects a missing dir — names the expected path', async () => {
    const serviceDir = makeServiceDir();
    writeServiceModule(serviceDir);

    await expect(
      assemble({
        build: dir({ module: moduleUrl(serviceDir), dir: '../dist/server', entry: 'start.js' }),
        address: 'svc',
        cwd: makeCwd(),
      }),
    ).rejects.toThrow(/no built directory at .*dist\/server/);
  });

  test('rejects a dir that is a file', async () => {
    const serviceDir = makeServiceDir();
    writeTree(path.join(serviceDir, 'dist'), { 'server.js': 'export default "app-entry";\n' });
    writeServiceModule(serviceDir);

    await expect(
      assemble({
        build: dir({ module: moduleUrl(serviceDir), dir: '../dist/server.js', entry: 'start.js' }),
        address: 'svc',
        cwd: makeCwd(),
      }),
    ).rejects.toThrow(/is not a directory/);
  });

  test('rejects an entry that is missing inside dir — names both', async () => {
    const serviceDir = makeServiceDir();
    writeTree(path.join(serviceDir, 'dist', 'server'), { 'index.html': '<html>\n' });
    writeServiceModule(serviceDir);

    await expect(
      assemble({
        build: dir({ module: moduleUrl(serviceDir), dir: '../dist/server', entry: 'start.js' }),
        address: 'svc',
        cwd: makeCwd(),
      }),
    ).rejects.toThrow(/no built entry at .*server\/start\.js.*resolves inside dir/s);
  });

  test('rejects an entry that escapes dir with ../ — the file it names exists, so only the escape can reject it', async () => {
    const serviceDir = makeServiceDir();
    writeTree(path.join(serviceDir, 'dist'), {
      'server/index.html': '<html>\n',
      'outside.js': 'export default "not in the tree";\n',
    });
    writeServiceModule(serviceDir);

    await expect(
      assemble({
        build: dir({
          module: moduleUrl(serviceDir),
          dir: '../dist/server',
          entry: '../outside.js',
        }),
        address: 'svc',
        cwd: makeCwd(),
      }),
    ).rejects.toThrow(/is not inside dir/);
  });

  test('rejects an absolute entry pointing outside dir', async () => {
    const serviceDir = makeServiceDir();
    writeTree(path.join(serviceDir, 'dist'), {
      'server/index.html': '<html>\n',
      'outside.js': 'export default "not in the tree";\n',
    });
    writeServiceModule(serviceDir);

    await expect(
      assemble({
        build: dir({
          module: moduleUrl(serviceDir),
          dir: '../dist/server',
          entry: path.join(serviceDir, 'dist', 'outside.js'),
        }),
        address: 'svc',
        cwd: makeCwd(),
      }),
    ).rejects.toThrow(/is not inside dir/);
  });

  test('rejects a dir that resolves inside the deploy-owned working dir', async () => {
    const cwd = makeCwd();
    const address = 'svc';
    const workDir = path.join(cwd, '.prisma-composer', 'artifacts', address);
    fs.mkdirSync(path.join(workDir, 'src'), { recursive: true });
    writeTree(path.join(workDir, 'build'), { 'start.js': 'export default "app-entry";\n' });

    await expect(
      assemble({
        build: dir({
          module: pathToFileURL(path.join(workDir, 'src', 'service.ts')).href,
          dir: '../build',
          entry: 'start.js',
        }),
        address,
        cwd,
      }),
    ).rejects.toThrow(/dir \(.*\) resolves inside the deploy working dir/);
  });

  test('rejects a dir that contains the deploy working dir — the copy would recurse into its own output', async () => {
    const serviceDir = makeServiceDir();
    const buildDir = path.join(serviceDir, 'dist', 'server');
    writeTree(buildDir, { 'start.js': 'export default "app-entry";\n' });
    writeServiceModule(serviceDir);
    // The deploy runs from inside the very tree it is told to copy.
    const cwd = path.join(buildDir, 'deploy');
    fs.mkdirSync(cwd, { recursive: true });

    await expect(
      assemble({
        build: dir({ module: moduleUrl(serviceDir), dir: '../dist/server', entry: 'start.js' }),
        address: 'svc',
        cwd,
      }),
    ).rejects.toThrow(/sits inside the build adapter's dir .* copy the artifact into itself/s);
  });

  test('rejects a tree containing a symlink, naming it — the packager rejects symlinks, and we ship what the build produced', async () => {
    const serviceDir = makeServiceDir();
    writeTree(path.join(serviceDir, 'dist'), {
      'server/start.js': 'export default "app-entry";\n',
      'shared/util.js': 'export const shared = 1;\n',
    });
    fs.symlinkSync(
      path.join(serviceDir, 'dist', 'shared', 'util.js'),
      path.join(serviceDir, 'dist', 'server', 'util.js'),
    );
    writeServiceModule(serviceDir);

    await expect(
      assemble({
        build: dir({ module: moduleUrl(serviceDir), dir: '../dist/server', entry: 'start.js' }),
        address: 'svc',
        cwd: makeCwd(),
      }),
    ).rejects.toThrow(/contains symlinks.*server\/util\.js/s);
  });

  test('reports a symlinked directory without descending into it', async () => {
    const serviceDir = makeServiceDir();
    writeTree(path.join(serviceDir, 'dist'), {
      'server/start.js': 'export default "app-entry";\n',
      'shared/util.js': 'export const shared = 1;\n',
    });
    fs.symlinkSync(
      path.join(serviceDir, 'dist', 'shared'),
      path.join(serviceDir, 'dist', 'server', 'vendor'),
    );
    writeServiceModule(serviceDir);

    await expect(
      assemble({
        build: dir({ module: moduleUrl(serviceDir), dir: '../dist/server', entry: 'start.js' }),
        address: 'svc',
        cwd: makeCwd(),
      }),
    ).rejects.toThrow(/contains symlinks.*server\/vendor/s);
  });

  test('rejects a dir that is itself a symlink — hard-errors instead of dereferencing it and copying the target', async () => {
    // ADR-0005: a symlink is never dereferenced, including when it's the
    // build adapter's `dir` value itself, not just something nested inside
    // it. `statSync` (used to confirm dir is a directory) follows a symlink,
    // so this case needs its own check — this test is what catches a
    // regression there.
    const serviceDir = makeServiceDir();
    writeTree(path.join(serviceDir, 'dist', 'real'), {
      'start.js': 'export default "app-entry";\n',
    });
    fs.symlinkSync(path.join(serviceDir, 'dist', 'real'), path.join(serviceDir, 'dist', 'server'));
    writeServiceModule(serviceDir);

    await expect(
      assemble({
        build: dir({ module: moduleUrl(serviceDir), dir: '../dist/server', entry: 'start.js' }),
        address: 'svc',
        cwd: makeCwd(),
      }),
    ).rejects.toThrow(/contains symlinks.*dist\/server/s);
  });

  test('fails assembly when the service module imports something the wrapper cannot resolve — no main.mjs emitted', async () => {
    const serviceDir = makeServiceDir();
    const cwd = makeCwd();
    const address = 'svc';
    writeTree(path.join(serviceDir, 'dist', 'server'), {
      'start.js': 'export default "app-entry";\n',
    });
    fs.writeFileSync(
      path.join(serviceDir, 'src', 'service.ts'),
      "import { thing } from 'totally-unresolvable-package-xyz';\nexport default { hello: thing };\n",
    );

    const workDir = path.join(cwd, '.prisma-composer', 'artifacts', address);

    await expect(
      assemble({
        build: dir({ module: moduleUrl(serviceDir), dir: '../dist/server', entry: 'start.js' }),
        address,
        cwd,
      }),
    ).rejects.toThrow(/Could not resolve/);

    expect(fs.existsSync(path.join(workDir, 'main.mjs'))).toBe(false);
  }, 20_000);
});
