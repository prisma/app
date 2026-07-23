/**
 * The store's shared pieces, unit-level: the keyset cursor codec
 * (base64url), the effective-ban predicate, and the ILIKE escaping. The SQL
 * that mirrors them is proven in pg-auth-store.integration.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { decodeCursor, encodeCursor, escapeLike, isEffectivelyBanned } from '../auth-store.ts';

describe('cursor codec', () => {
  test('round-trips a (createdAt, id) position', () => {
    const cursor = { createdAt: '2026-07-23T10:00:00.000Z', id: 'user-123' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  test('encodes base64url — no +, /, or = in the opaque string', () => {
    // Enough varied bytes to hit +/= in plain base64.
    const encoded = encodeCursor({ createdAt: '2026-07-23T10:00:00.000Z', id: '~~??>>__--' });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('an id containing the separator survives (first | wins)', () => {
    const cursor = { createdAt: '2026-07-23T10:00:00.000Z', id: 'weird|id|chars' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  test('rejects a cursor with no separator', () => {
    expect(() => decodeCursor(Buffer.from('no-separator').toString('base64url'))).toThrow(
      /invalid listUsers cursor/,
    );
  });
});

describe('isEffectivelyBanned', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  const past = new Date(Date.now() - 60_000).toISOString();

  test('banned with no expiry → banned', () => {
    expect(isEffectivelyBanned({ banned: true, banExpiresAt: null })).toBe(true);
  });

  test('banned with a future expiry → banned', () => {
    expect(isEffectivelyBanned({ banned: true, banExpiresAt: future })).toBe(true);
  });

  test('banned with a lapsed expiry → NOT banned', () => {
    expect(isEffectivelyBanned({ banned: true, banExpiresAt: past })).toBe(false);
  });

  test('not banned (false or column null) → not banned, whatever the expiry says', () => {
    expect(isEffectivelyBanned({ banned: false, banExpiresAt: future })).toBe(false);
    expect(isEffectivelyBanned({ banned: null, banExpiresAt: null })).toBe(false);
  });
});

describe('escapeLike', () => {
  test('escapes %, _, and backslash', () => {
    expect(escapeLike('100%_done\\now')).toBe('100\\%\\_done\\\\now');
  });

  test('leaves plain text alone', () => {
    expect(escapeLike('alice@example.com')).toBe('alice@example.com');
  });
});
