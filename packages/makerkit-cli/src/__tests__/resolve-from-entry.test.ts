import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CliError } from '../cli-error.ts';
import { importFromEntry } from '../resolve-from-entry.ts';

const tmpDirs: string[] = [];

/** A throwaway app package dir with one fixture dependency under node_modules — no real pack needed. */
function makeEntryPkgDir(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'makerkit-cli-resolve-')));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture-app' }));
  return dir;
}

function writeFixturePack(
  entryPkgDir: string,
  pack: string,
  subpath: string,
  moduleSource: string,
): void {
  const packDir = path.join(entryPkgDir, 'node_modules', pack);
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(
    path.join(packDir, 'package.json'),
    JSON.stringify({
      name: pack,
      type: 'module',
      exports: { [`./${subpath}`]: `./${subpath}.ts` },
    }),
  );
  fs.writeFileSync(path.join(packDir, `${subpath}.ts`), moduleSource);
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('importFromEntry() — entry-anchored resolution', () => {
  test('resolves and imports a fixture pack’s subpath entry declared via package.json exports', async () => {
    const entryPkgDir = makeEntryPkgDir();
    writeFixturePack(
      entryPkgDir,
      'fixture-pack',
      'target',
      "export function fromEnv() { return 'ok'; }\n",
    );

    const mod = await importFromEntry(entryPkgDir, 'fixture-pack', 'target');

    expect(
      typeof mod === 'object' &&
        mod !== null &&
        'fromEnv' in mod &&
        typeof mod.fromEnv === 'function'
        ? mod.fromEnv()
        : undefined,
    ).toBe('ok');
  });

  test('walks up to a parent directory’s node_modules, like Node/bun module resolution', async () => {
    const entryPkgDir = makeEntryPkgDir();
    writeFixturePack(
      entryPkgDir,
      'fixture-pack',
      'assemble',
      "export function assemble() { return 'assembled'; }\n",
    );
    const nestedDir = path.join(entryPkgDir, 'nested', 'deeper');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(nestedDir, 'package.json'), JSON.stringify({ name: 'nested-app' }));

    const mod = await importFromEntry(nestedDir, 'fixture-pack', 'assemble');

    expect(
      typeof mod === 'object' &&
        mod !== null &&
        'assemble' in mod &&
        typeof mod.assemble === 'function'
        ? mod.assemble()
        : undefined,
    ).toBe('assembled');
  });

  test('a missing pack throws a CliError naming the pack, the entry dir, and the fix', async () => {
    const entryPkgDir = makeEntryPkgDir();

    await expect(
      importFromEntry(entryPkgDir, '@makerkit/does-not-exist', 'target'),
    ).rejects.toThrow(CliError);
    await expect(
      importFromEntry(entryPkgDir, '@makerkit/does-not-exist', 'target'),
    ).rejects.toThrow(
      new RegExp(
        `Cannot resolve "@makerkit/does-not-exist/target" from ${entryPkgDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — the app's package must depend on "@makerkit/does-not-exist"`,
      ),
    );
  });

  test('a pack present but missing the requested subpath export throws the same way', async () => {
    const entryPkgDir = makeEntryPkgDir();
    const packDir = path.join(entryPkgDir, 'node_modules', 'fixture-pack');
    fs.mkdirSync(packDir, { recursive: true });
    fs.writeFileSync(
      path.join(packDir, 'package.json'),
      JSON.stringify({ name: 'fixture-pack', type: 'module', exports: { '.': './index.ts' } }),
    );
    fs.writeFileSync(path.join(packDir, 'index.ts'), 'export {};\n');

    await expect(importFromEntry(entryPkgDir, 'fixture-pack', 'target')).rejects.toThrow(
      /Cannot resolve "fixture-pack\/target"/,
    );
  });
});
