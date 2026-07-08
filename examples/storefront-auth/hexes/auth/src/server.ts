// The app's own entrypoint (the build adapter's `entry`) — the pack-printed
// bootstrap dynamically imports this AFTER main.run(address, boot) has
// re-keyed the platform environment address-free, so service.load() below
// reads it directly, with no address.

import type { Context } from 'hono';
import { Hono } from 'hono';
import service from './service.ts';

const { db, port } = service.load();

// A Prisma Postgres direct connection is closed when it goes idle (and when
// the service scales to zero). Bun.SQL surfaces that as an async error with
// no awaiter, which would otherwise crash the process into a 502 restart
// loop. Keep the process alive; the pool reconnects on the next query.
process.on('uncaughtException', (err) => console.error('uncaughtException', err));
process.on('unhandledRejection', (err) => console.error('unhandledRejection', err));

const app = new Hono();

// Prove the DB is reachable; map a failed query to 503 so the platform sees
// an unhealthy (not crashed) service.
const ping = async (c: Context) => {
  try {
    await db`SELECT 1`;
    return c.json({ ok: true });
  } catch (err) {
    console.error('db query failed', err);
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 503);
  }
};

app.get('/health', ping);
app.get('/verify', ping);

// Bind all interfaces — Compute routes external HTTP to the VM, so a
// loopback-only listener would be unreachable.
Bun.serve({ port, hostname: '0.0.0.0', fetch: app.fetch });
