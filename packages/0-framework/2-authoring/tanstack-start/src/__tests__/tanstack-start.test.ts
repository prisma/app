import { describe, expect, test } from 'bun:test';
import tanstackStart from '../index.ts';

describe('tanstackStart({ module, appDir })', () => {
  test('returns a plain TanStack Start build descriptor', () => {
    expect(tanstackStart({ module: 'file:///app/src/service.ts', appDir: '..' })).toEqual({
      extension: '@prisma/composer/tanstack-start',
      type: 'tanstack-start',
      module: 'file:///app/src/service.ts',
      appDir: '..',
      entry: 'server/index.mjs',
    });
  });

  test('carries appDir through unmodified for file-relative resolution at assembly time', () => {
    expect(
      tanstackStart({ module: 'file:///repo/apps/web/src/service.ts', appDir: '..' }).appDir,
    ).toBe('..');
  });

  test('is pure data — equal input yields equal, independent objects', () => {
    const a = tanstackStart({ module: 'file:///app/src/service.ts', appDir: '..' });
    const b = tanstackStart({ module: 'file:///app/src/service.ts', appDir: '..' });

    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
