import { defineService, postgres } from "@makerkit/core";

const port = Number(process.env.PORT ?? 3000);

/**
 * A single MakerKit service: it declares a Postgres dependency and receives a
 * typed `db` client, injected by the host shim. The handler never reads
 * `process.env` for its database — the shim hydrates `DATABASE_URL` and hands
 * over `db`. The handler owns its own server (no Output/serving model yet).
 */
export default defineService({ db: postgres() }, ({ db }) =>
  Bun.serve({
    port,
    hostname: "0.0.0.0",
    fetch: async () => Response.json(await db`select 1 as ok`),
  }),
);
