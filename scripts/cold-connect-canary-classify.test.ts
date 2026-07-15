import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type ColdConnectSample,
  classifyColdConnectRun,
  classifyColdConnectSample,
} from './cold-connect-canary-classify.ts';

describe('classifyColdConnectSample', () => {
  it('a successful connect (no error) → success', () => {
    assert.equal(classifyColdConnectSample(undefined), 'success');
  });

  it('the PPG cold-start upstream reject message → rejected', () => {
    assert.equal(
      classifyColdConnectSample(
        new Error('Failed to connect to upstream database. Please contact Prisma support'),
      ),
      'rejected',
    );
  });

  it('active-rejection socket codes → rejected', () => {
    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN']) {
      assert.equal(
        classifyColdConnectSample(Object.assign(new Error('x'), { code })),
        'rejected',
        code,
      );
    }
  });

  it('pool/server-close rejection messages → rejected', () => {
    for (const message of [
      'Connection terminated unexpectedly',
      'connection refused',
      'terminating connection due to administrator command',
      'server closed the connection unexpectedly',
    ]) {
      assert.equal(classifyColdConnectSample(new Error(message)), 'rejected', message);
    }
  });

  it('connect timeouts → timeout (not an active rejection)', () => {
    for (const error of [
      new Error('timeout expired'),
      new Error('Connection timeout'),
      Object.assign(new Error('x'), { code: 'ETIMEDOUT' }),
    ]) {
      assert.equal(classifyColdConnectSample(error), 'timeout');
    }
  });

  it('auth/quota errors → other (not assumed transient)', () => {
    assert.equal(
      classifyColdConnectSample(new Error('password authentication failed for user')),
      'other',
    );
    assert.equal(classifyColdConnectSample(new Error('quota exceeded')), 'other');
  });
});

describe('classifyColdConnectRun (unanimity)', () => {
  const run = (...s: ColdConnectSample[]) => classifyColdConnectRun(s);

  it('ANY rejection → PASS, even amid successes (a single rejection proves the bug)', () => {
    const result = run('success', 'success', 'rejected', 'success', 'success');
    assert.equal(result.pass, true);
    assert.match(result.message, /still present \(1\/5 rejected\)/);
  });

  it('ALL successes → FAIL with the remove-the-workaround signal', () => {
    const result = run('success', 'success', 'success', 'success', 'success');
    assert.equal(result.pass, false);
    assert.match(result.message, /FT-5226 fixed/);
  });

  it('no rejections but not all-success (timeouts) → FAIL inconclusive, not "fixed"', () => {
    const result = run('success', 'timeout', 'success', 'timeout', 'success');
    assert.equal(result.pass, false);
    assert.match(result.message, /Inconclusive/);
  });

  it('a lone success does not flip a rejecting run to "fixed"', () => {
    assert.equal(run('rejected', 'rejected', 'success').pass, true);
  });

  it('zero samples → FAIL (broken canary)', () => {
    assert.equal(classifyColdConnectRun([]).pass, false);
  });
});
