/**
 * A dummy auth service for TESTING a module that depends on auth — inject it in
 * place of the real one so a consumer's tests need no Postgres and no deploy.
 * It implements the real `authContract` (so its native router is type-checked against
 * the same contract the real auth exposes) with an in-memory `verify`. A
 * test-only entrypoint, deliberately outside `src/`, so it can never ride into
 * the deployed artifact.
 *
 * `serve()` needs a service node with the right `expose`, so this wraps a
 * minimal `compute()`. That node's `build` is inert — the fake is never
 * assembled or deployed, only `serve()`d on a loopback port by a consumer's
 * integration test.
 */

import node from '@prisma/composer/node';
import { implement, serve } from '@prisma/composer/rpc';
import { compute } from '@prisma/composer-prisma-cloud';
import { authContract } from '../src/contract.ts';

const fakeAuth = compute({
  name: 'auth-fake',
  deps: {},
  build: node({ module: import.meta.url, entry: 'fake.ts' }),
  expose: { rpc: authContract },
});

const rpc = implement(authContract.router);
const router = rpc.router({
  verify: rpc.verify.handler(({ input }) => ({ ok: input.token.length > 0 })),
  // The fake stands in for the auth dependency's wiring, not its secret: it
  // always proves the round trip. The real secret injection is proven by the
  // live auth service in the CI E2E.
  secretCheck: rpc.secretCheck.handler(() => ({ ok: true })),
});

export default serve(fakeAuth, { rpc: router });
