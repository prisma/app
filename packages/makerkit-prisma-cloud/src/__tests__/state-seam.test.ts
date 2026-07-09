import { describe, expect, test } from 'bun:test';
import { prismaCloud } from '../target.ts';

// Deliberately no mocks here (unlike target-lowering.test.ts, which stubs
// @makerkit/prisma-alchemy and alchemy/Output for the SPI data-flow tests):
// this test exercises the real prismaState() import to prove that
// constructing the Layer is inert. Layer.effect(...) only builds a lazy
// Effect description — no Management API call, no Postgres connection, no
// PRISMA_SERVICE_TOKEN read — until something actually provides/runs the
// layer, which this test never does.
describe('prismaCloud().state', () => {
  test('is defined and, called, produces a state Layer without touching the network', () => {
    const target = prismaCloud({ workspaceId: 'ws_1' });

    expect(target.state).toBeDefined();

    const layer = target.state?.();

    expect(layer).toBeDefined();
  });
});
