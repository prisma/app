/**
 * Deploy-side assembly for a TanStack Start app built by Nitro.
 *
 * The user owns `vite build` (ADR-0005). Composer reads the resulting
 * `.output/nitro.json`, validates that it is a `node-server` runnable, and
 * delegates the complete directory copy plus boot-wrapper build to the Node
 * directory adapter. The manifest supplies the server entry; no output path is
 * guessed and no framework code is rebuilt.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BuildAdapter } from '@internal/core';
import type { ExtensionDescriptor } from '@internal/core/config';
import type { AssembleInput, Bundle } from '@internal/core/deploy';
import node from '@internal/node';
import { assemble } from '@internal/node/control';
import type { TanStackStartBuildAdapter } from './index.ts';

function isTanStackStartBuild(descriptor: BuildAdapter): descriptor is TanStackStartBuildAdapter {
  return (
    descriptor.type === 'tanstack-start' &&
    'appDir' in descriptor &&
    typeof descriptor.appDir === 'string'
  );
}

function readNitroBuild(build: TanStackStartBuildAdapter): {
  outputDir: string;
  serverEntry: string;
} {
  const moduleDir = path.dirname(fileURLToPath(build.module));
  const appDir = path.resolve(moduleDir, build.appDir);
  const outputDir = path.join(appDir, '.output');
  const manifestPath = path.join(outputDir, 'nitro.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `no TanStack Start build manifest at ${manifestPath} — run \`vite build\` first.`,
    );
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid Nitro build manifest at ${manifestPath}: ${detail}`);
  }
  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error(`invalid Nitro build manifest at ${manifestPath}: expected an object.`);
  }

  const preset: unknown = Reflect.get(manifest, 'preset');
  if (preset !== 'node-server') {
    throw new Error(
      `${manifestPath} records preset ${JSON.stringify(preset)} — TanStack Start on Composer requires Nitro's "node-server" preset.`,
    );
  }

  const serverEntry: unknown = Reflect.get(manifest, 'serverEntry');
  if (typeof serverEntry !== 'string' || serverEntry.length === 0) {
    throw new Error(
      `${manifestPath} records no serverEntry — rebuild the TanStack Start app with Nitro's "node-server" preset.`,
    );
  }

  return { outputDir, serverEntry };
}

export async function assembleTanStackStart(input: AssembleInput): Promise<Bundle> {
  if (!isTanStackStartBuild(input.build)) {
    throw new Error(
      `@prisma/composer/tanstack-start/control: expected a "tanstack-start" build adapter (with appDir), got "${input.build.type}".`,
    );
  }
  const { outputDir, serverEntry } = readNitroBuild(input.build);

  return assemble({
    ...input,
    build: node({
      module: input.build.module,
      dir: outputDir,
      entry: serverEntry,
    }),
  });
}

/** The TanStack Start build extension descriptor listed in `prisma-composer.config.ts`. */
export const tanstackStartBuild = (): ExtensionDescriptor => ({
  id: '@prisma/composer/tanstack-start',
  nodes: {
    'tanstack-start': { kind: 'build', assemble: assembleTanStackStart },
  },
});
