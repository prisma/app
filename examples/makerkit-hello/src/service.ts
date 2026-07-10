import node from '@makerkit/node';
import { compute, postgres } from '@makerkit/prisma-cloud';
import { SQL } from 'bun';

// The dual form: one value is both the provisionable identity (hex.ts
// provisions this same object) and this service's dependency on it.
// idleTimeout closes the pooled connection before Compute's scale-to-zero drops
// it, so the next request reconnects instead of erroring (FT-5219).
export const db = postgres({
  name: 'db',
  client: ({ url }) => new SQL({ url, max: 1, idleTimeout: 10 }),
});

export default compute({
  name: 'hello',
  deps: { db },
  build: node({ module: import.meta.url, entry: '../dist/server.js' }),
});
