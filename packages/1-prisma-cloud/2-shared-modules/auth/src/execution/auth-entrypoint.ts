// The reusable boot module the auth service's build points `entry` at (see
// authService's `node({ entry: './auth-entrypoint.mjs' })`). Mirrors email's
// entrypoint: load() hands the hydrated `db` + minted `secret` bindings,
// config() the params — no env reads outside the framework accessors, and NO
// schema work at boot: the deploy migrated and marker-signed the auth space
// before this process exists (D5).

import { serve } from '@internal/service-rpc';
import { betterAuth } from 'better-auth';
import { buildAuthOptions } from '../auth-options.ts';
import { authService } from '../auth-service.ts';
import { createAuthHandlers } from '../handlers.ts';
import { createPgAuthStore } from '../pg-auth-store.ts';
import { composeAuthFetch } from './fetch-router.ts';

const service = authService();

const { db, secret } = service.load();
const { baseUrl, port } = service.config();

// S1: sendEmail absent — the three Better Auth send callbacks log the
// pinned not-wired line; slice S2 wires the email module here.
const auth = betterAuth(buildAuthOptions({ databaseUrl: db.url, secret: secret.value, baseUrl }));

// DB-direct handlers (D12): the ports authorize via wiring, never via
// Better Auth admin sessions — so they speak SQL through the service's own
// store, not auth.api.*.
const handlers = createAuthHandlers(createPgAuthStore(db.url));
const rpcHandler = serve(service, { session: handlers.session, admin: handlers.admin });

const fetchHandler = composeAuthFetch({ authHandler: auth.handler, rpcHandler });

Bun.serve({ port, hostname: '0.0.0.0', fetch: fetchHandler });
