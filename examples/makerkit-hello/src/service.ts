import node from '@makerkit/node';
import { compute, postgres } from '@makerkit/prisma-cloud';
import { SQL } from 'bun';

// The connection + its driver live here — the app's choice of client.
// max/idleTimeout keep the pool resilient to Compute's scale-to-zero.
const db = postgres({ client: ({ url }) => new SQL({ url, max: 1, idleTimeout: 10 }) });

// Declarations only — deps + build, no handler. The code that serves is
// src/server.ts (the build adapter's `entry`), which the app bundles itself.
export default compute({ deps: { db }, build: node({ entry: 'server.js' }) });
