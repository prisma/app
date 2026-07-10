import node from '@prisma/app-node';
import { compute, postgres } from '@prisma/app-cloud';
import { SQL } from 'bun';
import { authContract } from './contract.ts';

// idleTimeout closes the pooled connection before Compute's scale-to-zero drops
// it, so the next request reconnects instead of erroring (FT-5219).
export default compute({
  name: 'auth',
  deps: {
    db: postgres({ client: ({ url }) => new SQL({ url, max: 1, idleTimeout: 10 }) }),
  },
  build: node({ module: import.meta.url, entry: '../dist/server.js' }),
  expose: { rpc: authContract },
});
