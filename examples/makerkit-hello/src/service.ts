import { compute, postgres } from "@makerkit/prisma-cloud";
import { SQL } from "bun";

// The connection + its driver live here — the app's choice of client.
// max/idleTimeout keep the pool resilient to Compute's scale-to-zero.
const db = postgres({ client: ({ url }) => new SQL({ url, max: 1, idleTimeout: 10 }) });

/**
 * The authored service: a Compute service with a Postgres dependency. The
 * handler reads nothing from the environment — core's pipeline hydrates `db`
 * and resolves `port`.
 */
export default compute({ db }, ({ db }, { port }) =>
  Bun.serve({
    port,
    hostname: '0.0.0.0',
    fetch: async () => Response.json(await db`select 1 as ok`),
  }),
);
