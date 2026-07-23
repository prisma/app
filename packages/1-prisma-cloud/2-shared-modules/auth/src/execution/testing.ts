/**
 * `startLocalAuthServer` (D16): the module's official local-dev surface —
 * real Better Auth + the real DB-direct handlers against a caller-supplied
 * local Postgres, composed through the SAME fetch topology as the deployed
 * entrypoint. No cloud credentials: the pack's schema applies idempotently
 * at boot, the secret is a fixed dev value, and serve() runs in its
 * no-keys pass-through (nothing provisioned the accepted-keys env).
 *
 * Email: by default the S1 send seam captures `{ template, to, url }` into
 * `capturedEmails`, so a local flow can read its live verification /
 * reset / magic links before slice S2 wires real delivery. Supplying
 * `email` replaces the capture.
 */
import node from '@internal/node';
import { compute } from '@internal/prisma-cloud';
import { composeServiceFetch, serve } from '@internal/service-rpc';
import { betterAuth } from 'better-auth';
import pg from 'pg';
import { type AuthEmailSender, buildAuthOptions } from '../auth-options.ts';
import { authAdminContract, authApiContract, authSessionContract } from '../contract.ts';
import { createAuthHandlers } from '../handlers.ts';
import { AUTH_SCHEMA_SQL } from '../pack/schema-sql.ts';
import { createPgAuthStore } from '../pg-auth-store.ts';

/** One captured email touchpoint — `url` is the live link (verification/reset/magic). */
export interface CapturedAuthEmail {
  readonly template: 'verification' | 'passwordReset' | 'magicLink';
  readonly to: string;
  readonly url: string;
}

export interface LocalAuthServer {
  /** `http://127.0.0.1:<port>` */
  readonly url: string;
  /** Append-only; empty when a custom `email` sender was supplied. */
  readonly capturedEmails: readonly CapturedAuthEmail[];
  stop(): Promise<void>;
}

const LOCAL_DEV_SECRET = 'auth-local-dev-secret-not-for-production!';

export async function startLocalAuthServer(opts: {
  /** A caller-supplied local Postgres (e.g. `prisma dev`). */
  databaseUrl: string;
  /** Default 0 — an ephemeral port. */
  port?: number;
  /** Default: the server's own URL. */
  baseUrl?: string;
  /** Default: capture into `capturedEmails`. */
  email?: AuthEmailSender;
}): Promise<LocalAuthServer> {
  // The pack's schema, applied idempotently (every statement is IF NOT
  // EXISTS-guarded) — the local stand-in for the deploy's migration step.
  const bootstrap = new pg.Pool({ connectionString: opts.databaseUrl, max: 1 });
  try {
    await bootstrap.query(AUTH_SCHEMA_SQL);
  } finally {
    await bootstrap.end();
  }

  const capturedEmails: CapturedAuthEmail[] = [];
  const sendEmail: AuthEmailSender =
    opts.email ??
    (({ purpose, to, url }) => {
      capturedEmails.push({ template: purpose, to, url });
    });

  // serve() needs a service node with the right `expose`; this bare
  // compute()'s build is inert (never assembled or deployed) — email's
  // local-server pattern. The non-rpc `api` port rides along and is
  // skipped, exactly as on the deployed service.
  const localService = compute({
    name: 'authLocal',
    deps: {},
    build: node({ module: import.meta.url, entry: 'testing.ts' }),
    expose: { api: authApiContract, session: authSessionContract, admin: authAdminContract },
  });
  const handlers = createAuthHandlers(createPgAuthStore(opts.databaseUrl));
  const rpcHandler = serve(localService, {
    session: handlers.session,
    admin: handlers.admin,
  });

  // baseUrl defaults to the server's own URL, which needs the bound port —
  // so listen first with a late-bound handler, then compose.
  let fetchHandler: ((request: Request) => Promise<Response>) | undefined;
  const server = Bun.serve({
    port: opts.port ?? 0,
    hostname: '127.0.0.1',
    fetch: (request) => {
      if (fetchHandler === undefined) {
        return new Response('local auth server still booting', { status: 503 });
      }
      return fetchHandler(request);
    },
  });
  const url = `http://127.0.0.1:${server.port}`;

  const auth = betterAuth(
    buildAuthOptions({
      databaseUrl: opts.databaseUrl,
      secret: LOCAL_DEV_SECRET,
      baseUrl: opts.baseUrl ?? url,
      sendEmail,
    }),
  );
  fetchHandler = composeServiceFetch({
    rpcHandler,
    publicHandler: { pathPrefix: '/api/auth', handler: auth.handler },
  });

  return {
    url,
    capturedEmails,
    stop: async () => {
      server.stop(true);
    },
  };
}
