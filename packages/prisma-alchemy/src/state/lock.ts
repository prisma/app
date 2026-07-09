import { StateStoreError } from 'alchemy/State';
import * as Data from 'effect/Data';
import * as Effect from 'effect/Effect';
import type postgres from 'postgres';
import { toStateStoreError } from './errors.ts';

/** Another deploy already holds the lock for this stack/stage. Never queued — fails immediately. */
export class StateLockContentionError extends Data.TaggedError('StateLockContentionError')<{
  readonly stack: string;
  readonly stage: string;
}> {
  override get message(): string {
    return `another deploy holds the state lock for ${this.stack}/${this.stage}`;
  }
}

export interface StateLock {
  /**
   * Re-verifies the lease is still held by round-tripping the reserved
   * lock connection. Every state operation runs this first: if the
   * connection has dropped (e.g. an idle-closed direct connection —
   * FT-5219 class), the lease is gone and this fails loudly instead of
   * letting the operation run unlocked.
   */
  readonly checkLive: Effect.Effect<void, StateStoreError, never>;
  /** Unlocks and releases the reserved connection. Safe to call once the run ends. */
  readonly release: () => Promise<void>;
}

// Built here (not `select ... where 'makerkit:' || stack || '/' || stage`)
// so the lock id is computed once, in one place, from the same string every
// caller (JS or a human reading logs) would produce.
const lockKey = (stack: string, stage: string): string => `makerkit:${stack}/${stage}`;

/**
 * Acquires a session-scoped Postgres advisory lock on a reserved
 * connection pulled from `sql`'s pool — session (not transaction) scope,
 * because a transaction-scoped lock releases at the first commit and a
 * deploy spans many. Held for the run's whole lifetime; contention fails
 * immediately rather than queuing. If the process crashes, the reserved
 * connection drops and Postgres auto-releases the session lock — no
 * explicit crash-recovery bookkeeping needed.
 */
export const acquireStateLock = (
  sql: postgres.Sql,
  stack: string,
  stage: string,
): Effect.Effect<StateLock, StateLockContentionError | StateStoreError> =>
  Effect.gen(function* () {
    const key = lockKey(stack, stage);
    const reserved = yield* Effect.tryPromise({
      try: () => sql.reserve(),
      catch: toStateStoreError,
    });

    const acquired = yield* Effect.tryPromise({
      try: async () => {
        const rows = await reserved<{ acquired: boolean }[]>`
          select pg_try_advisory_lock(hashtextextended(${key}, 0)) as acquired
        `;
        return rows[0]?.acquired ?? false;
      },
      catch: toStateStoreError,
    });

    if (!acquired) {
      reserved.release();
      return yield* Effect.fail(new StateLockContentionError({ stack, stage }));
    }

    const checkLive: Effect.Effect<void, StateStoreError, never> = Effect.tryPromise({
      try: () => reserved`select 1`,
      catch: () =>
        new StateStoreError({
          message: `the state lock connection for ${stack}/${stage} was lost mid-run; refusing to continue unlocked`,
        }),
    }).pipe(Effect.asVoid);

    const release = async (): Promise<void> => {
      try {
        await reserved`select pg_advisory_unlock(hashtextextended(${key}, 0))`;
      } catch {
        // The connection already dropped — Postgres auto-releases a
        // session-scoped advisory lock when the session ends, so there is
        // nothing left to unlock.
      } finally {
        reserved.release();
      }
    };

    return { checkLive, release };
  });
