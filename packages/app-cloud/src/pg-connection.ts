/**
 * Connection resilience helpers shared by the deploy lowerings (the migration
 * and the warm-on-provision step) and the pnPostgres runtime client (slice 3,
 * FT-5226). Deliberately lightweight — no `@prisma-next/*` / control-plane
 * import — so it is safe to bundle into BOTH the deploy-only `control.ts` and
 * the runtime `./prisma-next` entry without breaking either isolation invariant.
 */

/** Network-level socket failures node-postgres surfaces as `err.code`. */
const TRANSIENT_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

/** Connection-establishment failure messages (no useful `err.code`). */
const TRANSIENT_MESSAGE_FRAGMENTS = [
  // Prisma Postgres's edge proxy while a cold/idle DB's upstream warms up.
  'upstream database',
  // node-postgres pool / server-close transients.
  'connection terminated',
  'connection refused',
  'terminating connection',
  'server closed the connection',
  'connection timeout',
  'timeout expired',
];

/**
 * Whether an error is a transient *connection* failure worth retrying — a cold
 * Prisma Postgres upstream reject, a network blip, or a dropped/closed socket —
 * as opposed to a real query error (a SQL-state failure) that must surface at
 * once. Used as the retry predicate for the runtime client, where retrying a
 * syntax error would be wrong.
 */
export function isTransientConnectionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  if (code !== undefined && TRANSIENT_CODES.has(code)) return true;
  const message =
    'message' in error && typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return TRANSIENT_MESSAGE_FRAGMENTS.some((fragment) => message.includes(fragment));
}

/**
 * Pin a deprecating TLS `sslmode` to the explicit `verify-full` so a Prisma
 * Postgres connection is warning-free and future-proof.
 *
 * PPG DSNs carry `sslmode=require`. node-postgres's `pg-connection-string`
 * (8.21) treats `require`/`prefer`/`verify-ca` as aliases for `verify-full`
 * (strict certificate + hostname verification) and emits a
 * `deprecatedSslModeWarning` warning that these will get weaker libpq semantics
 * in pg v9. PPG's certificate is publicly trusted, so `verify-full` connects
 * fine (proven live — every ssl posture connects once the DB is warm); the
 * connection failures were never TLS. Rewriting to the explicit `verify-full`
 * these already mean silences the deprecation warning and keeps full
 * verification when the pg-9 change lands. A DSN with no `sslmode`, or
 * `disable`/`no-verify`, is left untouched (a plain local Postgres still
 * connects without TLS).
 */
export function normalizeSslMode(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not a parseable URL — leave it; the driver surfaces its own error.
    return url;
  }
  const sslmode = parsed.searchParams.get('sslmode');
  if (sslmode === 'require' || sslmode === 'prefer' || sslmode === 'verify-ca') {
    parsed.searchParams.set('sslmode', 'verify-full');
    return parsed.toString();
  }
  return url;
}

/**
 * Retry a connection-bearing operation past a transient connection failure —
 * Prisma Postgres's post-provision / post-scale-to-zero cold-start (a fast,
 * `err.code`-less "Failed to connect to upstream database" reject that recovers
 * on a later attempt). Bounded (default ~1 min). `shouldRetry` decides what is
 * transient — by default everything is retried (the caller's operation only
 * fails on connection issues); the migration passes a predicate that never
 * retries a real migration failure, and the runtime client passes
 * {@link isTransientConnectionError} so a real query error surfaces at once.
 */
export async function withConnectionRetry<T>(
  operation: () => Promise<T>,
  opts: {
    readonly attempts?: number;
    readonly delayMs?: number;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly shouldRetry?: (error: unknown) => boolean;
  } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 12;
  const delayMs = opts.delayMs ?? 5000;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const shouldRetry = opts.shouldRetry ?? (() => true);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (!shouldRetry(error)) throw error;
      lastError = error;
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  throw lastError;
}
