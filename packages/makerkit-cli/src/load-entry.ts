/**
 * Pipeline step 1 (deploy-cli.md § The pipeline): import the entry module
 * (resolved against cwd) and require its default export to be a node — a
 * service or hex, branded by core's factories. Whatever this module exports
 * IS the application; nothing else marks a root (ADR-0003).
 */
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { HexNode, ServiceNode } from '@makerkit/core';
import { isNode } from '@makerkit/core';
import { blindCast } from '@makerkit/core/casts';
import { CliError } from './cli-error.ts';

export interface LoadedEntry {
  /** The resolved absolute path to the entry module on disk. */
  readonly path: string;
  readonly root: ServiceNode | HexNode;
}

export async function loadEntry(entryArg: string, cwd: string): Promise<LoadedEntry> {
  const resolvedPath = path.resolve(cwd, entryArg);
  // A dynamic import() with a non-literal specifier types as `any` — no cast
  // needed; the isNode()/kind checks below are the real (runtime) guard.
  const mod = await import(pathToFileURL(resolvedPath).href);
  const root: unknown = mod.default;

  if (!isNode(root) || root.kind === 'connection' || root.kind === 'resource') {
    throw new CliError(
      `Entry module "${resolvedPath}" must default-export a node (a service or a hex) — ` +
        'construct it with service() or hex() from @makerkit/core.',
    );
  }

  return {
    path: resolvedPath,
    root: blindCast<
      ServiceNode | HexNode,
      "isNode() plus the kind check above prove root is a service or hex node at runtime; isNode's return type (NodeBase | HexNode) is the common supertype and structurally lacks each kind's own fields, so TS cannot narrow further on its own"
    >(root),
  };
}
