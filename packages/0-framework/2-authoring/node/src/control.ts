/**
 * The extension's control entry (ADR-0017): `nodeBuild()` returns the build
 * descriptor `prisma-compose.config.ts` lists. Deploy-only (ADR-0005): the user
 * builds their own runnable; `assemble` copies that compiled output under
 * `bundle/` and adds the framework's boot wrapper — it never bundles,
 * transforms, or completes the user's tree.
 *
 * The wrapper is a SEPARATE tsdown build of the service module (declarations
 * only, whose node carries run()/load()), emitted as `main.mjs` at the
 * working-dir root — a dictated name (object entry `{ main }`), not a
 * discovered one. run() and the app entry must be independent module instances
 * that hand off through process.env, so the wrapper is its own self-contained
 * build; `@prisma/*` is inlined, `bun` is a Compute built-in.
 *
 * Artifact layout: `<cwd>/.prisma-compose/artifacts/<address>/` (deploy-owned,
 * ADR-0005) holds `main.mjs` at the root and the user's output under `bundle/`.
 * Paths are file-relative (ADR-0004): `entry` and `dir` resolve against
 * `dirname(build.module)`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionDescriptor } from '@internal/core/config';
import type { AssembleInput, Bundle } from '@internal/core/deploy';
import { build } from 'tsdown';

export type { AssembleInput, Bundle } from '@internal/core/deploy';

export async function assemble(input: AssembleInput): Promise<Bundle> {
  if (input.build.type !== 'node') {
    throw new Error(
      `@prisma/compose/node/control: expected a "node" build adapter, got "${input.build.type}".`,
    );
  }

  const serviceModule = fileURLToPath(input.build.module);
  const moduleDir = path.dirname(serviceModule);
  const entryPath = path.resolve(moduleDir, input.build.entry);
  if (!fs.existsSync(entryPath)) {
    throw new Error(
      `no built entry at ${entryPath} — run your build first (the build adapter's ` +
        `entry, "${input.build.entry}", resolves against dirname(module)).`,
    );
  }

  // The compiled-output root shipped under bundle/, defaulting to the entry's
  // own directory. Next passes the standalone root explicitly (its entry nests
  // below the hoisted node_modules).
  const outputDir = path.resolve(moduleDir, input.build.dir ?? path.dirname(input.build.entry));
  const entryRel = path.relative(outputDir, entryPath);
  if (entryRel.startsWith('..') || path.isAbsolute(entryRel)) {
    throw new Error(
      `the build adapter's entry ("${input.build.entry}") is not inside its output dir ` +
        `("${outputDir}") — entry must be a path within dir.`,
    );
  }

  const workDir = path.join(input.cwd, '.prisma-compose', 'artifacts', input.address);
  // The working dir is cleared each run; the user's output must sit outside it,
  // both ways (inside → the rm eats it; containing → we'd copy workDir into itself).
  if (
    outputDir === workDir ||
    outputDir.startsWith(workDir + path.sep) ||
    workDir.startsWith(outputDir + path.sep)
  ) {
    throw new Error(
      `the build adapter's output dir ("${outputDir}") overlaps the deploy working dir ` +
        `("${workDir}") — point dir/entry at your build output elsewhere.`,
    );
  }
  await fs.promises.rm(workDir, { recursive: true, force: true });
  await fs.promises.mkdir(workDir, { recursive: true });

  await build({
    entry: { main: serviceModule },
    outDir: workDir,
    format: 'esm',
    platform: 'node',
    external: ['bun'],
    noExternal: [/^@prisma\//, ...(input.wrapperNoExternal ?? [])],
    dts: false,
    sourcemap: false,
    clean: false,
    // Self-contained runtime bundle: do NOT auto-load a discovered
    // `tsdown.config.ts`. This package's build config enables tsdown's
    // `exports` management, which would rewrite THIS package's package.json
    // `exports` to point at the throwaway bundle dir — corrupting resolution
    // of `@prisma/compose/node` for everything that imports it afterward.
    config: false,
  });
  if (!fs.existsSync(path.join(workDir, 'main.mjs'))) {
    throw new Error(`tsdown produced no main.mjs in ${workDir}`);
  }

  await fs.promises.cp(outputDir, path.join(workDir, 'bundle'), { recursive: true });

  return { dir: workDir, entry: path.posix.join('bundle', entryRel.split(path.sep).join('/')) };
}

/** The node build extension descriptor — `prisma-compose.config.ts` lists it under `extensions`. */
export const nodeBuild = (): ExtensionDescriptor => ({
  id: '@prisma/compose/node',
  nodes: {
    node: { kind: 'build', assemble },
  },
});
