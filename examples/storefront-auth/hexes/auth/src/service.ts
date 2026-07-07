import { compute, postgres } from "@makerkit/prisma-cloud";
import { Hono } from "hono";
import type { Context } from "hono";
import { SQL } from "bun";

// The connection + its driver live here — the app's choice of client.
// One connection, closed client-side once idle (before the server drops it)
// and re-established on demand — resilient to Compute's scale-to-zero.
const db = postgres({ client: ({ url }) => new SQL({ url, max: 1, idleTimeout: 10 }) });

/**
 * The auth service: a Compute service with a Postgres dependency. The handler
 * reads nothing from the environment — core's pipeline hydrates `db` and
 * resolves `port`.
 */
export default compute({ db }, ({ db }, { port }) => {
  // A Prisma Postgres direct connection is closed when it goes idle (and when
  // the service scales to zero). Bun.SQL surfaces that as an async error with
  // no awaiter, which would otherwise crash the process into a 502 restart
  // loop. Keep the process alive; the pool reconnects on the next query.
  process.on("uncaughtException", (err) => console.error("uncaughtException", err));
  process.on("unhandledRejection", (err) => console.error("unhandledRejection", err));

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
  return Bun.serve({ port, hostname: '0.0.0.0', fetch: app.fetch });
});
