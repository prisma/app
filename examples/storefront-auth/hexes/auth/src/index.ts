import { Hono } from "hono";
import type { Context } from "hono";
import { SQL } from "bun";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const sql = new SQL({ url });

const app = new Hono();

app.get("/health", async (c: Context) => {
  await sql`SELECT 1`;
  return c.json({ ok: true });
});

app.get("/verify", async (c: Context) => {
  await sql`SELECT 1`;
  return c.json({ ok: true });
});

const port = Number(process.env.PORT ?? 3000);

// Bind all interfaces explicitly — Compute routes external HTTP to the VM, so a
// loopback-only listener would be unreachable.
Bun.serve({ port, hostname: "0.0.0.0", fetch: app.fetch });
console.log(`auth listening on 0.0.0.0:${port}`);
