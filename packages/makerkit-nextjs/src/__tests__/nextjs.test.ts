import { describe, expect, test } from 'bun:test';
import nextjs from '../index.ts';

describe('nextjs({ entry })', () => {
  test('returns a plain { kind, entry } build adapter descriptor', () => {
    expect(nextjs({ entry: 'server.js' })).toEqual({ kind: 'nextjs', entry: 'server.js' });
  });

  test("carries the entry through unmodified — Next's standalone server.js, service-dir-relative", () => {
    expect(nextjs({ entry: '.next/standalone/server.js' }).entry).toBe(
      '.next/standalone/server.js',
    );
  });

  test('is pure data — calling it twice with the same input yields equal, independent objects', () => {
    const a = nextjs({ entry: 'server.js' });
    const b = nextjs({ entry: 'server.js' });

    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
