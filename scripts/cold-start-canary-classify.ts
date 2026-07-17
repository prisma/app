/**
 * Pass/fail logic for cold-start-canary.ts (PRO-217), split out for offline
 * unit testing — the cold-connect-canary-classify.ts pattern applied to the
 * Compute face of the cold-start family.
 *
 * PRO-217 (the ingress closes a first-touch connection while a scale-to-zero
 * service boots) is INTERMITTENT: on most cold hits the edge holds the
 * connection and the request just takes seconds, and only sometimes closes it
 * mid-establishment (~400 ms fast-fail, observed via examples/streams). One
 * touch against a freshly promoted instance can therefore land on one of
 * three outcomes, not two:
 *
 * - a 502 whose body names a socket close, arriving fast — the bug
 *   reproduced. A close only happens during the boot window, so this alone
 *   proves the touch reached a cold start; no further evidence is needed.
 * - a 201 that independent evidence (the deployment's own boot logs, or —
 *   when logs cannot be read — the response latency) confirms was sent
 *   before the app finished booting — the edge held the connection through
 *   a real cold start. Genuine evidence toward "fixed".
 * - a 201 that arrived before there was anything left to boot through — no
 *   cold start happened, so the touch says nothing about the bug either way.
 *
 * A canary that folds the second and third cases together (as this file
 * once did, mapping every 201 straight to "held") can report "fixed" from
 * touches that never went near a cold instance — see gotchas.md's PRO-217
 * entry for the run that did exactly that. `classifyColdStartTouch` refuses
 * to guess the cold/warm distinction itself: the caller must resolve it
 * (from logs or latency) and pass the answer in as `coldStartConfirmed`.
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
export type ColdStartTouch = 'held' | 'closed' | 'no-cold-start' | 'other';

/**
 * Classifies one first-touch response from the CALLER's seat.
 *
 * `coldStartConfirmed` is the caller's answer to "did this touch actually
 * race a boot?", decided from the deployment's own logs (or, as a fallback,
 * from latency) before this function is called. A 201 only becomes `held`
 * when that's true; otherwise it's `no-cold-start` — a successful append that
 * proves nothing, because nothing was booting when it landed. A 502 naming
 * the close is `closed` regardless of `coldStartConfirmed`: the close itself
 * only happens mid-boot, so it is its own proof.
 */
export function classifyColdStartTouch(
  status: number,
  body: string,
  coldStartConfirmed: boolean,
): ColdStartTouch {
  if (status === 201) return coldStartConfirmed ? 'held' : 'no-cold-start';
  const lower = body.toLowerCase();
  if (status === 502 && CLOSE_FRAGMENTS.some((fragment) => lower.includes(fragment))) {
    return 'closed';
  }
  return 'other';
}

/**
 * Strips ANSI SGR color codes from spark's boot log lines (the platform's
 * own log lines are colorized; the app's own log lines observed so far are
 * not, but stripping first makes the timestamp regex robust either way).
 * Built from String.fromCharCode rather than a regex literal containing the
 * raw ESC byte, which Biome's noControlCharactersInRegex rule (rightly)
 * rejects.
 */
export function stripAnsiCodes(text: string): string {
  const ESC = String.fromCharCode(27);
  return text.split(new RegExp(`${ESC}\\[[0-9;]*m`, 'g')).join('');
}

/**
 * The streams server's own boot line — e.g. "[2026-07-17T12:04:10.313Z]
 * [INFO] prisma-streams server listening on 0.0.0.0:3000" — read from a
 * deployment's log history (`?from_start=true`). Returns the timestamp it
 * logged, or undefined if the boot never reached it (or the log read didn't
 * cover it).
 */
export function findListeningTimestamp(logText: string): Date | undefined {
  const match = stripAnsiCodes(logText).match(
    /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)]\s*\[INFO]\s*prisma-streams server listening/,
  );
  const timestamp = match?.[1];
  return timestamp !== undefined ? new Date(timestamp) : undefined;
}

/**
 * True only when the touch was sent before the deployment's own log shows it
 * finished booting — i.e. the touch genuinely raced a cold start rather than
 * landing on an instance that was already up and listening.
 */
export function touchRacedBoot(touchSentAt: Date, listeningAt: Date | undefined): boolean {
  return listeningAt !== undefined && touchSentAt.getTime() < listeningAt.getTime();
}

/**
 * The three exits a REQUIRED check needs (the job fails only on the
 * conclusive forcing signal):
 * - `bug-present` → exit 0 (a close occurred; today's normal),
 * - `bug-gone` → exit 1 (every touch reached a genuinely fresh, booting
 *   instance and every one of them held — the actionable removal message is
 *   the point of the failure),
 * - `inconclusive` → exit 0 plus a CI warning annotation (loud, not blocking
 *   every PR on a deploy flake or a run that never managed to force a cold
 *   start; a human should look).
 */
export type ColdStartVerdict = 'bug-present' | 'bug-gone' | 'inconclusive';

export interface ColdStartResult {
  readonly verdict: ColdStartVerdict;
  readonly message: string;
}

/**
 * Aggregates N first touches. A close anywhere is decisive on its own (rule:
 * a close only happens mid-boot, so it needs no corroboration). Short of
 * that, the run is only allowed to say "fixed" once it has proven it forced
 * a cold start on every single touch and every one of them held — a touch
 * that landed on an already-warm instance (`no-cold-start`) or came back
 * some other inconclusive way (`other`) means the run never earned an
 * opinion, so the whole run reports `inconclusive` rather than mixing an
 * uninformative touch into a "clean" verdict.
 */
export function classifyColdStartRun(touches: readonly ColdStartTouch[]): ColdStartResult {
  const n = touches.length;
  if (n === 0) return { verdict: 'inconclusive', message: 'Canary made no touches — broken.' };
  const count = (t: ColdStartTouch) => touches.filter((x) => x === t).length;
  const closed = count('closed');
  const held = count('held');
  const noColdStart = count('no-cold-start');
  const other = count('other');

  if (closed > 0) {
    return {
      verdict: 'bug-present',
      message:
        `Cold-start close still present (${closed}/${n} first touches closed, ${held} held, ` +
        `${noColdStart} never went cold) — PRO-217 not fixed; keep the PRO-219 backoff in ` +
        'createStreamsClient.',
    };
  }

  if (noColdStart > 0 || other > 0) {
    return {
      verdict: 'inconclusive',
      message:
        `The canary failed to force a cold start on ${noColdStart + other}/${n} touches ` +
        `(${noColdStart} landed on an already-warm instance, ${other} were otherwise ` +
        'inconclusive) — a run that never reaches a cold instance has no opinion to report on ' +
        'PRO-217. A human should look; not blocking.',
    };
  }

  // Every touch reached a fresh, booting instance (no-cold-start === 0,
  // other === 0) and none closed, so held === n here.
  return {
    verdict: 'bug-gone',
    message:
      `All ${n} first touches against genuinely fresh, still-booting instances were held to ` +
      'success — the platform no longer shows the PRO-217 close, so the workaround exists with ' +
      'no problem. To fix this build (you are seeing it because the cleanup is now due, not ' +
      'because of your change): ' +
      '1) delete IDEMPOTENT_BACKOFF and its uses in createStreamsClient ' +
      '(packages/1-prisma-cloud/2-shared-modules/streams/src/client.ts); ' +
      '2) remove scripts/cold-start-canary.ts, scripts/cold-start-canary-classify.ts (+ its ' +
      'test) and the "Cold-start canary (PRO-217)" job in .github/workflows/e2e-deploy.yml; ' +
      "3) drop the removal-guard paragraph from gotchas.md's PRO-217 entry; 4) close PRO-219.",
  };
}
