import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyColdConnectResult } from './cold-connect-canary-classify.ts';

describe('classifyColdConnectResult', () => {
  it('fails when the connect succeeded (no error) — the platform bug looks fixed', () => {
    const result = classifyColdConnectResult(undefined);
    assert.equal(result.pass, false);
    assert.match(result.message, /FT-5226 fixed/);
  });

  it('passes for the PPG cold-start upstream reject message', () => {
    const result = classifyColdConnectResult(
      new Error('Failed to connect to upstream database. Please contact Prisma support'),
    );
    assert.equal(result.pass, true);
  });

  it('passes for active-rejection socket codes', () => {
    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN']) {
      const result = classifyColdConnectResult(Object.assign(new Error('x'), { code }));
      assert.equal(result.pass, true, `expected ${code} to pass`);
    }
  });

  it('passes for pool/server-close rejection messages', () => {
    for (const message of [
      'Connection terminated unexpectedly',
      'connection refused',
      'terminating connection due to administrator command',
      'server closed the connection unexpectedly',
    ]) {
      const result = classifyColdConnectResult(new Error(message));
      assert.equal(result.pass, true, `expected "${message}" to pass`);
    }
  });

  it('fails as inconclusive on connect timeouts — a timeout is not an active rejection', () => {
    for (const error of [
      new Error('timeout expired'),
      new Error('Connection timeout'),
      Object.assign(new Error('x'), { code: 'ETIMEDOUT' }),
    ]) {
      const result = classifyColdConnectResult(error);
      assert.equal(result.pass, false);
      assert.match(result.message, /Inconclusive/);
    }
  });

  it('fails on a non-transient error, with a message distinguishing it from a fixed platform', () => {
    const result = classifyColdConnectResult(new Error('password authentication failed for user'));
    assert.equal(result.pass, false);
    assert.match(result.message, /not the known cold-start rejection/);
  });

  it('fails on an unrecognized error rather than assuming it is transient', () => {
    const result = classifyColdConnectResult(new Error('quota exceeded'));
    assert.equal(result.pass, false);
  });
});
