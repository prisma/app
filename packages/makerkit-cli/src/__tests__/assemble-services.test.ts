import { afterEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Graph } from '@makerkit/core';
import { hex, Load, service } from '@makerkit/core';
import { assembleServices } from '../assemble-services.ts';

const tmpDirs: string[] = [];

/** A tmp dir with a package.json — a real anchor `findPackageDir` can resolve. */
function makeAnchoredDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'makerkit-cli-assemble-'));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true });
  }
});

const fakeRun = async (_specifier: string, input: { serviceDir: string }) => ({
  dir: path.join(input.serviceDir, 'dist', 'bundle'),
  entry: 'server.js',
});

describe('assembleServices()', () => {
  test('a service root produces a single `bundle`', async () => {
    const dir = makeAnchoredDir();
    const root = service({
      name: 'svc',
      pack: 'test/pack',
      type: 'fixture/service',
      url: pathToFileURL(path.join(dir, 'service.ts')).href,
      inputs: {},
      params: {},
      build: { kind: 'node', entry: 'server.js' },
    });
    const graph = Load(root);

    const assembled = await assembleServices(graph, false, dir, fakeRun);

    expect(assembled.bundle).toEqual({ dir: path.join(dir, 'dist', 'bundle'), entry: 'server.js' });
    expect(assembled.bundles).toBeUndefined();
  });

  test('a hex root produces `bundles` keyed by each service’s provision id', async () => {
    const dirOne = makeAnchoredDir();
    const dirTwo = makeAnchoredDir();
    const makeService = (name: string, dir: string) =>
      service({
        name,
        pack: 'test/pack',
        type: 'fixture/service',
        url: pathToFileURL(path.join(dir, 'service.ts')).href,
        inputs: {},
        params: {},
        build: { kind: 'node', entry: 'server.js' },
      });
    const root = hex('fixture-hex', (h) => {
      h.provision('auth', makeService('auth', dirOne));
      h.provision('storefront', makeService('storefront', dirTwo));
    });
    const graph: Graph = Load(root);

    const assembled = await assembleServices(graph, true, dirOne, fakeRun);

    expect(assembled.bundles).toEqual({
      auth: { dir: path.join(dirOne, 'dist', 'bundle'), entry: 'server.js' },
      storefront: { dir: path.join(dirTwo, 'dist', 'bundle'), entry: 'server.js' },
    });
    expect(assembled.bundle).toBeUndefined();
  });

  test('an unknown build adapter kind names the kind and the known kinds', async () => {
    const dir = makeAnchoredDir();
    const root = service({
      name: 'svc',
      pack: 'test/pack',
      type: 'fixture/service',
      url: pathToFileURL(path.join(dir, 'service.ts')).href,
      inputs: {},
      params: {},
      build: { kind: 'deno', entry: 'server.js' },
    });
    const graph = Load(root);

    await expect(assembleServices(graph, false, dir, fakeRun)).rejects.toThrow(
      /declares build kind "deno".*known kinds: nextjs, node/,
    );
  });

  test('no package.json above the service url — names the anchor problem', async () => {
    // A fresh tmp dir with NO package.json anywhere above it.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'makerkit-cli-noanchor-'));
    tmpDirs.push(dir);
    const root = service({
      name: 'svc',
      pack: 'test/pack',
      type: 'fixture/service',
      url: pathToFileURL(path.join(dir, 'service.ts')).href,
      inputs: {},
      params: {},
      build: { kind: 'node', entry: 'server.js' },
    });
    const graph = Load(root);

    await expect(assembleServices(graph, false, dir, fakeRun)).rejects.toThrow(
      /needs a package anchor/,
    );
  });
});
