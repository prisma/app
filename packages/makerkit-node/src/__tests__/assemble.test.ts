import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assemble } from '../assemble.ts';

const tmpDirs: string[] = [];

/** A tmp dir standing in for a service package: src/service.ts + a dist/ sibling. */
function makeServiceDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'makerkit-node-assemble-'));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
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
        build: { kind: 'nextjs', module: moduleUrl(serviceDir), entry: 'server.js' },
      }),
    ).rejects.toThrow(/expected a "node" build adapter/);
  });

  test('rejects when the declared build entry is missing — names the expected path', async () => {
    const serviceDir = makeServiceDir();
    await expect(
      assemble({
        build: { kind: 'node', module: moduleUrl(serviceDir), entry: '../dist/server.js' },
      }),
    ).rejects.toThrow(/no built entry at .*dist\/server\.js/);
  });

  test('rejects an app entry named main.js — reserved for the wrapper', async () => {
    const serviceDir = makeServiceDir();
    fs.mkdirSync(path.join(serviceDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(serviceDir, 'dist', 'main.js'), 'export {};\n');
    await expect(
      assemble({
        build: { kind: 'node', module: moduleUrl(serviceDir), entry: '../dist/main.js' },
      }),
    ).rejects.toThrow(/reserved for the MakerKit wrapper/);
  });

  test('produces a bundle dir (beside the built entry) containing the wrapper and a copy of the built entry', async () => {
    const serviceDir = makeServiceDir();
    fs.mkdirSync(path.join(serviceDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(serviceDir, 'dist', 'server.js'), 'export default "app-entry";\n');
    fs.writeFileSync(
      path.join(serviceDir, 'src', 'service.ts'),
      'export default { hello: "wrapper" as const };\n',
    );

    const result = await assemble({
      build: { kind: 'node', module: moduleUrl(serviceDir), entry: '../dist/server.js' },
    });

    expect(result.dir).toBe(path.join(serviceDir, 'dist', 'bundle'));
    expect(result.entry).toBe('server.js');
    expect(fs.existsSync(path.join(result.dir, 'server.js'))).toBe(true);
    const hasWrapper =
      fs.existsSync(path.join(result.dir, 'main.js')) ||
      fs.existsSync(path.join(result.dir, 'main.mjs'));
    expect(hasWrapper).toBe(true);
    // The copied entry is untouched — same module instance as the user's build.
    expect(fs.readFileSync(path.join(result.dir, 'server.js'), 'utf8')).toContain('app-entry');
  }, 20_000);
});
