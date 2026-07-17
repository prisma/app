import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type ColdStartTouch,
  classifyColdStartRun,
  classifyColdStartTouch,
  findListeningTimestamp,
  stripAnsiCodes,
  touchRacedBoot,
} from './cold-start-canary-classify.ts';

describe('classifyColdStartTouch', () => {
  it('a 201 confirmed to have raced the boot → held (the edge carried the request through it)', () => {
    assert.equal(classifyColdStartTouch(201, '{"appended":{"n":1}}', true), 'held');
  });

  it('a 201 NOT confirmed to have raced the boot → no-cold-start (it proves nothing about PRO-217)', () => {
    assert.equal(classifyColdStartTouch(201, '{"appended":{"n":1}}', false), 'no-cold-start');
  });

  it("the jobs service's surfaced close → closed (the PRO-217 signal), regardless of coldStartConfirmed", () => {
    const body =
      'streams unreachable: Error: The socket connection was closed unexpectedly. For more information, pass `verbose: true`';
    assert.equal(classifyColdStartTouch(502, body, true), 'closed');
    assert.equal(classifyColdStartTouch(502, body, false), 'closed');
  });

  it('reset/refused faces of the same close → closed', () => {
    for (const body of ['ECONNRESET while fetching', 'connect ECONNREFUSED', 'socket hang up']) {
      assert.equal(classifyColdStartTouch(502, body, false), 'closed', body);
    }
  });

  it('a 502 whose cause is something else → other (inconclusive, not a close)', () => {
    assert.equal(classifyColdStartTouch(502, 'append failed: 500', false), 'other');
  });

  it('any other status → other, regardless of coldStartConfirmed', () => {
    assert.equal(classifyColdStartTouch(500, 'boom', true), 'other');
    assert.equal(classifyColdStartTouch(404, 'not found', false), 'other');
    assert.equal(classifyColdStartTouch(200, 'ok but not an append', true), 'other');
  });
});

describe('stripAnsiCodes', () => {
  it('removes SGR escape sequences from spark boot log lines', () => {
    const colorized = `${String.fromCharCode(27)}[90m[${String.fromCharCode(27)}[0m2026-07-17T12:04:08Z ${String.fromCharCode(27)}[32mINFO ${String.fromCharCode(27)}[0m spark::app_source${String.fromCharCode(27)}[90m]${String.fromCharCode(27)}[0m compute.manifest.json not found`;
    assert.equal(
      stripAnsiCodes(colorized),
      '[2026-07-17T12:04:08Z INFO  spark::app_source] compute.manifest.json not found',
    );
  });

  it('leaves plain text untouched', () => {
    assert.equal(stripAnsiCodes('[INFO] plain line, no escapes'), '[INFO] plain line, no escapes');
  });
});

describe('findListeningTimestamp', () => {
  it("reads the streams server's own listening line", () => {
    const log =
      'streams: bootstrapping local state from the object store\r\n' +
      '[2026-07-17T12:04:10.313Z] [INFO] prisma-streams server listening on 0.0.0.0:3000\r\n';
    const found = findListeningTimestamp(log);
    assert.ok(found);
    assert.equal(found?.toISOString(), '2026-07-17T12:04:10.313Z');
  });

  it('returns undefined when the log never reached a listening line (e.g. read cut off mid-boot)', () => {
    const log =
      'spark: starting bun with entrypoint: bootstrap.js\r\n' +
      'streams: bootstrapping local state from the object store\r\n';
    assert.equal(findListeningTimestamp(log), undefined);
  });

  it('returns undefined for an empty or unrelated log', () => {
    assert.equal(findListeningTimestamp(''), undefined);
    assert.equal(findListeningTimestamp('some other server started fine'), undefined);
  });
});

describe('touchRacedBoot', () => {
  it('true when the touch was sent before the app finished booting', () => {
    const touchSentAt = new Date('2026-07-17T12:04:09.000Z');
    const listeningAt = new Date('2026-07-17T12:04:10.313Z');
    assert.equal(touchRacedBoot(touchSentAt, listeningAt), true);
  });

  it('false when the touch was sent after the app was already listening', () => {
    const touchSentAt = new Date('2026-07-17T12:04:11.000Z');
    const listeningAt = new Date('2026-07-17T12:04:10.313Z');
    assert.equal(touchRacedBoot(touchSentAt, listeningAt), false);
  });

  it('false when there is no listening timestamp to compare against', () => {
    assert.equal(touchRacedBoot(new Date(), undefined), false);
  });
});

describe('classifyColdStartRun (the three-exit mapping of a REQUIRED check)', () => {
  const run = (...touches: ColdStartTouch[]) => classifyColdStartRun(touches);

  it('no touches → inconclusive (broken canary; warn, do not block)', () => {
    assert.equal(run().verdict, 'inconclusive');
  });

  it("one close among holds → bug-present (exit 0; today's normal)", () => {
    const result = run('held', 'closed', 'held', 'held');
    assert.equal(result.verdict, 'bug-present');
    assert.match(result.message, /1\/4 first touches closed/);
    assert.match(result.message, /PRO-217 not fixed/);
  });

  it('a close is decisive even alongside touches that never went cold', () => {
    const result = run('closed', 'no-cold-start', 'no-cold-start', 'no-cold-start');
    assert.equal(result.verdict, 'bug-present');
  });

  it('all held, every touch a confirmed cold start → bug-gone (exit 1 — the forcing signal), actionable for a cold reader', () => {
    const result = run('held', 'held', 'held', 'held');
    assert.equal(result.verdict, 'bug-gone');
    assert.match(result.message, /not because of your change/);
    assert.match(result.message, /IDEMPOTENT_BACKOFF/);
    assert.match(result.message, /streams\/src\/client\.ts/);
    assert.match(result.message, /cold-start-canary\.ts/);
    assert.match(result.message, /e2e-deploy\.yml/);
    assert.match(result.message, /gotchas\.md/);
    assert.match(result.message, /PRO-219/);
  });

  it('any touch that never went cold makes the whole run inconclusive, even with no closes and some holds', () => {
    const result = run('held', 'no-cold-start', 'held', 'held');
    assert.equal(result.verdict, 'inconclusive');
    assert.match(result.message, /failed to force a cold start/);
    assert.match(result.message, /1\/4 touches/);
    assert.match(result.message, /not blocking/);
  });

  it('all touches never going cold → inconclusive, not a clean bill of health', () => {
    const result = run('no-cold-start', 'no-cold-start', 'no-cold-start', 'no-cold-start');
    assert.equal(result.verdict, 'inconclusive');
    assert.match(result.message, /4\/4 touches/);
  });

  it('an "other" (broken/ambiguous) touch also blocks a bug-gone verdict', () => {
    const result = run('held', 'held', 'held', 'other');
    assert.equal(result.verdict, 'inconclusive');
  });
});
