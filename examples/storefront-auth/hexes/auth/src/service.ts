import node from '@makerkit/node';
import { compute, postgres } from '@makerkit/prisma-cloud';
import { SQL } from 'bun';

// The connection + its driver live here — the app's choice of client.
// One connection, closed client-side once idle (before the server drops it)
// and re-established on demand — resilient to Compute's scale-to-zero.
const db = postgres({ client: ({ url }) => new SQL({ url, max: 1, idleTimeout: 10 }) });

/**
 * The auth service: a Compute service with a Postgres dependency, self-served
 * via a plain node/Hono entry (src/server.ts). Declarations only — the node
 * carries no handler; `server.ts` is the app's own entrypoint.
 */
export default compute({ deps: { db }, build: node({ entry: 'server.js' }) });
