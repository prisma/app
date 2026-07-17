/**
 * Marks a service as a TanStack Start app built by Nitro for deployment.
 *
 * `tanstackStart({ module, appDir })` names the app root: the directory that
 * contains the Vite config and receives Nitro's `.output/`, resolved relative
 * to `dirname(module)` like an import specifier (ADR-0004). Build the app with
 * Vite first; deploy reads Nitro's manifest, validates its `node-server`
 * preset, and ships the complete output tree.
 *
 * Returns plain data — nothing runs on import. `extension` + `type` are the
 * control-plane registry key: deploy tooling routes assembly through the app's
 * `prisma-composer.config.ts` to this package's `/control` descriptor
 * (ADR-0017).
 */
import type { BuildAdapter } from '@internal/core';

/** The TanStack Start build descriptor. The assembler locates `.output` and reads the actual entry from Nitro's manifest. */
export interface TanStackStartBuildAdapter extends BuildAdapter {
  readonly type: 'tanstack-start';
  readonly appDir: string;
}

const tanstackStart = (opts: { module: string; appDir: string }): TanStackStartBuildAdapter => ({
  extension: '@prisma/composer/tanstack-start',
  type: 'tanstack-start',
  module: opts.module,
  appDir: opts.appDir,
  // BuildAdapter carries an entry for every kind. The assembler replaces this
  // convention with Nitro's authoritative `serverEntry` from nitro.json.
  entry: 'server/index.mjs',
});

export default tanstackStart;
