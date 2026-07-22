/**
 * Directory-form assemble machinery shared by the `node()` and `dir()` build
 * adapters' control entries: resolving and validating a built directory plus
 * the entry file inside it (ADR-0004), the symlink hard error the tree is
 * copied verbatim under (ADR-0005), the deploy-working-dir overlap guard,
 * and the boot wrapper esbuild build both adapters emit identically as
 * `main.mjs`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { build } from 'esbuild';

/** A validated built directory plus the entry file inside it, both resolved absolute. */
export interface ResolvedDir {
  /** The built directory, resolved against `dirname(module)` (ADR-0004). */
  readonly dirPath: string;
  /** The entry file inside `dirPath`, resolved absolute. */
  readonly entryPath: string;
  /** `entryPath` relative to `dirPath`, POSIX-separated — the Bundle entry's suffix. */
  readonly entryRel: string;
}

/**
 * Validates `dirSpec` resolves to a directory (against `moduleDir`, ADR-0004)
 * and `entrySpec` resolves to a file inside it — never outside. Neither path
 * is discovered: both are named by the descriptor and only those two are
 * checked.
 */
export async function resolveDir(
  dirSpec: string,
  entrySpec: string,
  moduleDir: string,
): Promise<ResolvedDir> {
  const dirPath = path.resolve(moduleDir, dirSpec);
  if (!fs.existsSync(dirPath)) {
    throw new Error(
      `no built directory at ${dirPath} — run your build first (the build adapter's ` +
        `dir, "${dirSpec}", resolves against dirname(module)).`,
    );
  }
  if (!fs.statSync(dirPath).isDirectory()) {
    throw new Error(
      `the build adapter's dir ("${dirPath}") is not a directory — drop dir to deploy a ` +
        'single built file, naming it as entry.',
    );
  }

  const entryPath = path.resolve(dirPath, entrySpec);
  if (!entryPath.startsWith(dirPath + path.sep)) {
    throw new Error(
      `the build adapter's entry ("${entrySpec}") resolves to ${entryPath}, which is not inside ` +
        `dir ("${dirPath}") — in the directory form entry names a file inside dir, and only dir is copied.`,
    );
  }
  if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
    throw new Error(
      `no built entry at ${entryPath} — run your build first (the build adapter's entry, ` +
        `"${entrySpec}", resolves inside dir, "${dirPath}").`,
    );
  }

  await assertNoSymlinks(dirPath);

  return {
    dirPath,
    entryPath,
    entryRel: path.relative(dirPath, entryPath).split(path.sep).join('/'),
  };
}

/**
 * Compute's packager rejects symlinks, so a tree containing one cannot
 * deploy. We fail here, naming the links, rather than dereferencing them on
 * the copy: the artifact must be what the author's build produced
 * (ADR-0005), and following a link that points outside `dirPath` would pull
 * in files the author never named. The walk reads dirents (lstat
 * semantics), so a symlinked directory is reported and never descended
 * into.
 */
export async function assertNoSymlinks(dirPath: string): Promise<void> {
  const found: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await fs.promises.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) found.push(full);
      else if (entry.isDirectory()) await walk(full);
    }
  };
  await walk(dirPath);

  if (found.length === 0) return;
  const listed = found.slice(0, 5).join(', ');
  throw new Error(
    `the build adapter's dir ("${dirPath}") contains symlinks, which the platform's packager ` +
      `rejects: ${listed}${found.length > 5 ? `, and ${found.length - 5} more` : ''}. The tree is ` +
      'copied verbatim, so make your build emit real files in dir (for example, a hoisted ' +
      'node_modules, or dereference the links into dir with cp -RL).',
  );
}

/**
 * The working dir is cleared on every assemble, so it must not overlap the
 * copy source: inside it, the rm would delete the source before the copy;
 * the other way round, the copy would recurse into its own output.
 */
export function assertOutsideWorkDir(source: string, sourceField: string, workDir: string): void {
  if (source === workDir || source.startsWith(workDir + path.sep)) {
    throw new Error(
      `the build adapter's ${sourceField} ("${source}") resolves inside the deploy working dir ` +
        `("${workDir}"), which is cleared on every assemble — point ${sourceField} at your build output elsewhere.`,
    );
  }
  if (workDir.startsWith(source + path.sep)) {
    throw new Error(
      `the deploy working dir ("${workDir}") sits inside the build adapter's ${sourceField} ` +
        `("${source}"), so assembling would copy the artifact into itself — point ${sourceField} ` +
        'at your build output elsewhere.',
    );
  }
}

/**
 * The wrapper is a SEPARATE esbuild build of the service module (declarations
 * only, whose node carries run()/load()), emitted as `main.mjs` at the
 * working-dir root — a dictated name (object entry `{ main }`), not a
 * discovered one. `bun`/`bun:*`/`node:*` externalize (runtime built-ins);
 * everything else — including `@prisma/*` — inlines, because the artifact's
 * node_modules holds only what the app's OWN build traced.
 */
export async function buildWrapper(serviceModule: string, workDir: string): Promise<void> {
  await build({
    entryPoints: { main: serviceModule },
    outdir: workDir,
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['bun', 'bun:*'],
    outExtension: { '.js': '.mjs' },
  });
  if (!fs.existsSync(path.join(workDir, 'main.mjs'))) {
    throw new Error(`esbuild produced no main.mjs in ${workDir}`);
  }
}
