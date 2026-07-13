/// <reference types="bun" />
/**
 * Integration proof (testing.md § Integration): the real request path — the
 * actual Next.js standalone entry, the real RPC client, real HTTP — driven
 * by `bootstrapService` against a fake auth listening on a loopback port. No
 * cloud, no deploy; `server.ts`/the Next build output are untouched. Run via
 * `bun test` (not vitest — the unit test's runner): it needs `Bun.serve` for
 * the loopback fake, and the H3 teardown decision (no `close()`) rests on
 * bun-test's per-file process isolation.
 *
 * storefront's build is `node({ dir, entry })` pointing at the Next standalone
 * tree: `entry` is the built server.js, resolved relative to `build.module` like
 * every node build. `bootstrapService`'s default derivation boots a service's
 * own entry, which is exactly that here, but this test supplies its own boot
 * thunk to make the standalone boot explicit. Requires `next build` to have
 * produced `.next/standalone` (turbo's `test` task depends on `build`, so
 * `pnpm -w test` always has it).
 */
import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BuildAdapter } from '@prisma/compose';
import { bootstrapService } from '@prisma/compose-prisma-cloud/testing';
import fakeAuthHandler from '@storefront-auth/auth/fake';
import storefrontService from '../src/service.ts';

const PORT = 4310;

/** Boots the built standalone Next entry — its own `server.js`, unmodified — via the same path `assemble()` resolves for deploy (entry relative to the authoring module). The deploy chain is bootstrap.js -> main.mjs -> server.js; here `bootstrapService`'s `stash` stands in for the wrapper's env write. */
function bootStandaloneNext(build: BuildAdapter): () => Promise<void> {
  const entryPath = path.resolve(path.dirname(fileURLToPath(build.module)), build.entry);
  return async () => {
    await import(pathToFileURL(entryPath).href);
  };
}

describe('storefront -> auth round trip, driven over real HTTP (bootstrapService)', () => {
  it('renders auth.verify() -> { ok: true } served by the fake auth on a loopback port', async () => {
    const fake = Bun.serve({ port: 0, fetch: fakeAuthHandler });

    const app = await bootstrapService(
      storefrontService,
      { service: { port: PORT }, inputs: { auth: { url: fake.url.href } } },
      bootStandaloneNext(storefrontService.build),
    );

    const res = await app.fetch(new Request(app.url));
    // React separates the static text from the {String(ok)} expression with an
    // empty `<!-- -->` comment; assert around it rather than stripping HTML.
    const html = await res.text();

    expect(html).toContain('Auth /verify says: <!-- -->true');
  });
});
