/**
 * Pipeline step 1 (deploy-cli.md § The pipeline): import the entry module
 * (resolved against cwd) and require its default export to be a node — a
 * service or system, branded by core's factories. Whatever this module exports
 * IS the application; nothing else marks a root (ADR-0003).
 */
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ServiceNode, SystemNode } from '@prisma/app';
import { isNode } from '@prisma/app';
import { blindCast } from '@prisma/app/casts';
import { CliError } from './cli-error.ts';

export interface LoadedEntry {
  /** The resolved absolute path to the entry module on disk. */
  readonly path: string;
  readonly root: ServiceNode | SystemNode;
}

export async function loadEntry(entryArg: string, cwd: string): Promise<LoadedEntry> {
  const resolvedPath = path.resolve(cwd, entryArg);
  // A dynamic import() with a non-literal specifier types as `any` — no cast
  // needed; the isNode()/kind checks below are the real (runtime) guard.
  const mod = await import(pathToFileURL(resolvedPath).href);
  const root: unknown = mod.default;

  if (!isNode(root) || root.kind === 'dependency' || root.kind === 'resource') {
    throw new CliError(
      `Entry module "${resolvedPath}" must default-export a node (a service or a system) — ` +
        'construct it with service() or system() from @prisma/app.',
    );
  }

  return {
    path: resolvedPath,
    root: blindCast<
      ServiceNode | SystemNode,
      "isNode() plus the kind check above prove root is a service or system node at runtime; isNode's return type (NodeBase | SystemNode) is the common supertype and structurally lacks each kind's own fields, so TS cannot narrow further on its own"
    >(root),
  };
}
