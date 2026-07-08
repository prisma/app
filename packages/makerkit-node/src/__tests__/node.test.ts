import { describe, expect, test } from 'bun:test';
import node from '../index.ts';

describe('node({ entry })', () => {
  test('returns a plain { kind, entry } build adapter descriptor', () => {
    expect(node({ entry: 'server.js' })).toEqual({ kind: 'node', entry: 'server.js' });
  });

  test('carries the entry through unmodified — service-dir-relative, never rewritten', () => {
    expect(node({ entry: 'dist/server.js' }).entry).toBe('dist/server.js');
  });

  test('is pure data — calling it twice with the same input yields equal, independent objects', () => {
    const a = node({ entry: 'server.js' });
    const b = node({ entry: 'server.js' });

    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
