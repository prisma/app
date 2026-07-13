import { describe, expect, test } from 'bun:test';
import { Load } from '@prisma/compose';
import root from './module.ts';

describe('storefront-auth root graph', () => {
  test('the auth secret need forwards from the root binding down to the inner service', () => {
    // Loads the REAL app graph: dropping the module→service forward, renaming
    // the slot, or removing the root envSecret binding all break this — none of
    // which typecheck catches, and the only other graph-Loading gate is CI E2E.
    const graph = Load(root);
    expect(graph.secrets).toEqual([
      { serviceAddress: 'auth.service', slot: 'signingKey', name: 'AUTH_SIGNING_SECRET' },
    ]);
  });
});
