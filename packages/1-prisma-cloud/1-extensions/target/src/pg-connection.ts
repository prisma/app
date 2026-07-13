/** Connection resilience helpers shared by the deploy lowerings and the pnPostgres runtime client (FT-5226); no heavy imports, so it's safe in both. The transient-error predicate and retry live in `@internal/foundation` so bun-runnable services (e.g. the storage store) share one implementation; re-exported here for this package's existing consumers. */

export {
  isTransientConnectionError,
  retryTransientConnect,
  withConnectionRetry,
} from '@internal/foundation/connection-retry';

/**
 * Rewrites a deprecating `sslmode` (`require`/`prefer`/`verify-ca`) to the
 * explicit `verify-full` these already mean, silencing node-postgres's
 * deprecation warning. `disable`/`no-verify`/unset are left untouched.
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
