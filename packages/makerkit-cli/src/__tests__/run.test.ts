/**
 * Drives main.ts's run() end to end with fakes at the module seams the CLI
 * already exposes (RunDeps): a fake assembler (no real wrapper build) and a
 * fake alchemy runner (no real process). The entry module, the package
 * anchor, and the generated stack file are all real — written to a temp dir.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CliError } from '../cli-error.ts';
import { run } from '../main.ts';
import type { RunAlchemyInput } from '../run-alchemy.ts';

const coreIndex = path.resolve(
  import.meta.dir,
  '..',
  '..',
  '..',
  'makerkit-core',
  'src',
  'index.ts',
);

const tmpDirs: string[] = [];
let previousWorkspaceId: string | undefined;

/**
 * A real app package in a temp dir: package.json + an entry module whose
 * default export is a genuine service node (importing core by absolute path
 * — the temp dir has no node_modules). Pack is @makerkit/prisma-cloud so
 * inferTarget's dynamic import resolves from this package and fromEnv() works
 * against the PRISMA_WORKSPACE_ID set in beforeEach.
 */
function makeAppDir(name = 'fixture-app'): { dir: string; entryPath: string } {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'makerkit-cli-run-')));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  const entryPath = path.join(dir, 'service.ts');
  fs.writeFileSync(
    entryPath,
    [
      `import { service } from ${JSON.stringify(coreIndex)};`,
      '',
      'export default service({',
      `  name: ${JSON.stringify(name)},`,
      "  pack: '@makerkit/prisma-cloud',",
      "  type: 'prisma-cloud/compute',",
      '  url: import.meta.url,',
      '  inputs: {},',
      '  params: {},',
      "  build: { kind: 'node', entry: 'dist/server.js' },",
      '});',
      '',
    ].join('\n'),
  );
  return { dir, entryPath };
}

const fakeAssembler = async (_specifier: string, input: { serviceDir: string }) => ({
  dir: path.join(input.serviceDir, 'dist', 'bundle'),
  entry: 'server.js',
});

beforeEach(() => {
  previousWorkspaceId = process.env['PRISMA_WORKSPACE_ID'];
  process.env['PRISMA_WORKSPACE_ID'] = 'ws-test';
});

afterEach(() => {
  if (previousWorkspaceId === undefined) delete process.env['PRISMA_WORKSPACE_ID'];
  else process.env['PRISMA_WORKSPACE_ID'] = previousWorkspaceId;
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('run() — the full pipeline over fakes', () => {
  test('a successful deploy generates the stack file and invokes alchemy against it', async () => {
    const app = makeAppDir('hello-run');
    const calls: RunAlchemyInput[] = [];

    const status = await run(['deploy', app.entryPath, '--stage', 'ci-7'], {
      runAssembler: fakeAssembler,
      alchemy: (input) => {
        calls.push(input);
        return 0;
      },
    });

    expect(status).toBe(0);
    expect(calls).toEqual([
      {
        command: 'deploy',
        stackFileRelativePath: path.join('.makerkit', 'alchemy.run.ts'),
        cwd: app.dir,
        stage: 'ci-7',
      },
    ]);

    const stackPath = path.join(app.dir, '.makerkit', 'alchemy.run.ts');
    const content = fs.readFileSync(stackPath, 'utf8');
    expect(content).toContain('name: "hello-run"');
    expect(content).toContain('import app from "../service.ts";');
    expect(content).toContain(
      `bundle: { dir: ${JSON.stringify(path.join(app.dir, 'dist', 'bundle'))}, entry: "server.js" }`,
    );
  });

  test('--name with an empty value is a CliError naming the fix', async () => {
    const app = makeAppDir();

    await expect(
      run(['deploy', app.entryPath, '--name', ''], {
        runAssembler: fakeAssembler,
        alchemy: () => 0,
      }),
    ).rejects.toThrow(CliError);
    await expect(
      run(['deploy', app.entryPath, '--name', ''], {
        runAssembler: fakeAssembler,
        alchemy: () => 0,
      }),
    ).rejects.toThrow(/name it at authoring, or pass --name/);
  });

  test('an alchemy failure propagates the nonzero exit and prints the generated file path', async () => {
    const app = makeAppDir();
    const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const status = await run(['deploy', app.entryPath], {
        runAssembler: fakeAssembler,
        alchemy: () => 42,
      });

      expect(status).toBe(42);
      const stackPath = path.join(app.dir, '.makerkit', 'alchemy.run.ts');
      const printed = errorSpy.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(printed).toContain(stackPath);
    } finally {
      errorSpy.mockRestore();
    }
  });

  test('a destroy blocked by missing built output explains that destroy needs the build too', async () => {
    const app = makeAppDir();
    const failingAssembler = async () => {
      throw new Error('no built entry at /some/dist/server.js — run this app’s own build first');
    };

    const error: unknown = await run(['destroy', app.entryPath], {
      runAssembler: failingAssembler,
      alchemy: () => 0,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CliError);
    const message = (error as CliError).message;
    expect(message).toContain('no built entry at');
    expect(message).toContain('destroy evaluates the same stack program as deploy');
    expect(message).toContain('Run the build, then retry the destroy.');
  });

  test('the same assembly failure on deploy keeps its original message, without the destroy note', async () => {
    const app = makeAppDir();
    const failingAssembler = async () => {
      throw new Error('no built entry at /some/dist/server.js');
    };

    const error: unknown = await run(['deploy', app.entryPath], {
      runAssembler: failingAssembler,
      alchemy: () => 0,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('no built entry at');
    expect(message).not.toContain('destroy evaluates');
  });
});
