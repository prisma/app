/**
 * Pass/fail logic for cold-start-canary.ts (PRO-217), split out for offline
 * unit testing — the cold-connect-canary-classify.ts pattern applied to the
 * Compute face of the cold-start family.
 *
 * PRO-217 (the ingress closes a first-touch connection while a scale-to-zero
 * service boots) is INTERMITTENT: on most cold hits the edge holds the
 * connection and the request just takes seconds, and only sometimes closes it
 * mid-establishment (~400 ms fast-fail, observed via examples/streams). So one
 * touch can't tell "fixed" from "the edge held this time": the canary touches
 * N freshly promoted instances and only trusts the aggregate — a single close
 * proves the bug, and only a unanimous run of holds is evidence (not proof)
 * it may be gone.
 */

/**
 * The caller (the jobs service's 502-with-cause guard) surfaces the close as
 * `streams unreachable: … socket connection was closed …`; a direct Bun/node
 * caller shows the same message or an ECONNRESET/ECONNREFUSED code. Keep in
 * sync with gotchas.md's PRO-217 entry.
 */
const CLOSE_FRAGMENTS = [
  'socket connection was closed',
  'econnreset',
  'econnrefused',
  'socket hang up',
];

/** One first-touch outcome against a freshly promoted instance. */
export type ColdStartTouch = 'held' | 'closed' | 'other';

/**
 * Classifies one first-touch response from the CALLER's seat: the append
 * succeeding (201) means the edge held the connection through the boot; a 502
 * whose cause names a socket close is PRO-217; anything else (a timeout, an
 * app error, a broken canary) is inconclusive.
 */
export function classifyColdStartTouch(status: number, body: string): ColdStartTouch {
  if (status === 201) return 'held';
  const lower = body.toLowerCase();
  if (status === 502 && CLOSE_FRAGMENTS.some((fragment) => lower.includes(fragment))) {
    return 'closed';
  }
  return 'other';
}

export interface ColdStartResult {
  readonly pass: boolean;
  readonly message: string;
}

/**
 * Aggregates N first touches with the FT-5226 canary's unanimity rule:
 * - any close → PASS (PRO-217 still present — one close proves it),
 * - all N held → FAIL: the close looks gone; remove the PRO-219 workaround
 *   (createStreamsClient's IDEMPOTENT_BACKOFF) and this canary. N holds are
 *   EVIDENCE, not proof — the bug is intermittent — which is exactly why the
 *   failure message says to investigate, not just delete.
 * - otherwise → FAIL inconclusive (odd statuses, no close, not all held) —
 *   a human should look before touching the workaround.
 */
export function classifyColdStartRun(touches: readonly ColdStartTouch[]): ColdStartResult {
  const n = touches.length;
  if (n === 0) return { pass: false, message: 'Canary made no touches — broken.' };
  const count = (t: ColdStartTouch) => touches.filter((x) => x === t).length;
  const closed = count('closed');
  const held = count('held');

  if (closed > 0) {
    return {
      pass: true,
      message:
        `Cold-start close still present (${closed}/${n} first touches closed, ${held} held) — ` +
        'PRO-217 not fixed; keep the PRO-219 backoff in createStreamsClient.',
    };
  }
  if (held === n) {
    return {
      pass: false,
      message:
        `All ${n} first touches against fresh instances were held to success — the PRO-217 ` +
        'close may be fixed (evidence, not proof: it is intermittent). If this stays clean, ' +
        "remove createStreamsClient's IDEMPOTENT_BACKOFF (the PRO-219 compensation, " +
        'packages/1-prisma-cloud/2-shared-modules/streams/src/client.ts) and this canary.',
    };
  }
  return {
    pass: false,
    message:
      `Inconclusive across ${n} touches (${held} held, ${count('other')} other, 0 closes) — ` +
      'a slow boot, an app error, or a broken canary. Investigate before touching the workaround.',
  };
}
