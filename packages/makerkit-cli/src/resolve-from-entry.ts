/**
 * Resolves a pack's subpath entry (e.g. a target's `/target` or an adapter's
 * `/assemble`) anchored at the app's entry package, not at the CLI's own
 * location (ADR-0004's package-anchor idea, applied to module resolution).
 * This is what lets the CLI ship with no dependency on any specific pack: the
 * pack only needs to appear in the APP's own dependency tree.
 *
 * Anchoring uses `createRequire(entryPkgDir/package.json).resolve(...)`.
 * Node's CJS resolver still honors a package's `exports` map for require()
 * (not just import()), and bun's `createRequire` follows the same contract —
 * both verified against fixture packages under both runtimes. `import.meta.resolve()`
 * was ruled out: node's version resolves only relative to the calling module
 * with no parent argument, so it can't be anchored at an arbitrary directory.
 */
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CliError } from './cli-error.ts';

/**
 * Node's require.resolve() throws an Error with .code "MODULE_NOT_FOUND".
 * Bun's throws its own ResolveMessage — same .code, but NOT an Error
 * instance — so this checks the property directly rather than narrowing via
 * `instanceof Error` first.
 */
function isModuleNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'MODULE_NOT_FOUND'
  );
}

/** The specifier `${pack}/${subpath}`, resolved from `entryPkgDir` and imported. */
export async function importFromEntry(
  entryPkgDir: string,
  pack: string,
  subpath: string,
): Promise<unknown> {
  const specifier = `${pack}/${subpath}`;
  const require = createRequire(path.join(entryPkgDir, 'package.json'));

  let resolved: string;
  try {
    resolved = require.resolve(specifier);
  } catch (error) {
    if (isModuleNotFound(error)) {
      throw new CliError(
        `Cannot resolve "${specifier}" from ${entryPkgDir} — the app's package must depend on ` +
          `"${pack}".`,
      );
    }
    throw error;
  }

  return import(pathToFileURL(resolved).href);
}
