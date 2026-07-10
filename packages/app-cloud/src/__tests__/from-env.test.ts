import { describe, expect, test } from 'bun:test';
import { fromEnv } from '../target.ts';

/** Sets env vars for the duration of `fn`, restoring whatever was there before. */
async function withEnv<T>(values: Record<string, string | undefined>, fn: () => T): Promise<T> {
  const previous = new Map(Object.keys(values).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of previous) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('fromEnv() — the pack CLI seam (ADR-0003)', () => {
  test('builds a Target from PRISMA_WORKSPACE_ID alone', async () => {
    await withEnv({ PRISMA_WORKSPACE_ID: 'ws-123', PRISMA_REGION: undefined }, () => {
      const target = fromEnv();
      expect(target.name).toBe('prisma-cloud');
    });
  });

  test('accepts a known PRISMA_REGION', async () => {
    await withEnv({ PRISMA_WORKSPACE_ID: 'ws-123', PRISMA_REGION: 'eu-west-3' }, () => {
      expect(() => fromEnv()).not.toThrow();
    });
  });

  test('throws naming PRISMA_WORKSPACE_ID when it is missing', async () => {
    await withEnv({ PRISMA_WORKSPACE_ID: undefined, PRISMA_REGION: undefined }, () => {
      expect(() => fromEnv()).toThrow(/PRISMA_WORKSPACE_ID/);
    });
  });

  test('throws naming the bad value when PRISMA_REGION is not a known region', async () => {
    await withEnv({ PRISMA_WORKSPACE_ID: 'ws-123', PRISMA_REGION: 'mars-1' }, () => {
      expect(() => fromEnv()).toThrow(/PRISMA_REGION="mars-1"/);
    });
  });
});
