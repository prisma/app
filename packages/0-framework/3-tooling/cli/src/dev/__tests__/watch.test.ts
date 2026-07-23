import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startWatch, watchTargetsFrom } from '../watch.ts';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cli-watch-'));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('watchTargetsFrom()', () => {
  test('a bundle with no watch field is reported unwatchable, not a target', () => {
    const { targets, unwatchable } = watchTargetsFrom({
      web: { dir: '/tmp/web', entry: 'server.js' },
    });
    expect(targets).toEqual([]);
    expect(unwatchable).toEqual(['web']);
  });
});

describe('startWatch()', () => {
  test('debounces a burst of changes across several files into one callback, 300ms after the last change', async () => {
    const dir = tempDir();
    const fileA = path.join(dir, 'a.txt');
    const fileB = path.join(dir, 'b.txt');
    fs.writeFileSync(fileA, 'a');
    fs.writeFileSync(fileB, 'b');

    let calls = 0;
    const stop = startWatch(
      [
        { address: 'a', paths: [fileA] },
        { address: 'b', paths: [fileB] },
      ],
      () => {
        calls += 1;
      },
    );

    try {
      // A burst across both files, all inside the 300ms debounce window.
      fs.writeFileSync(fileA, 'a2');
      await sleep(50);
      fs.writeFileSync(fileB, 'b2');
      await sleep(50);
      fs.writeFileSync(fileA, 'a3');

      // Still inside the debounce window from the last write — no callback yet.
      await sleep(100);
      expect(calls).toBe(0);

      // Past the 300ms debounce from the last write.
      await sleep(300);
      expect(calls).toBe(1);
    } finally {
      stop();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 10_000);

  test('a stopped watch fires no further callbacks', async () => {
    const dir = tempDir();
    const file = path.join(dir, 'a.txt');
    fs.writeFileSync(file, 'a');

    let calls = 0;
    const stop = startWatch([{ address: 'a', paths: [file] }], () => {
      calls += 1;
    });
    stop();

    fs.writeFileSync(file, 'a2');
    await sleep(500);
    expect(calls).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 10_000);
});
