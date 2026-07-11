/**
 * The `prisma-app.config.ts` surface (ADR-0017): the config file statically
 * imports each extension's `/control` entry and hands `defineConfig` the
 * resulting descriptors, plus the ONE state store backing the deploy. Core
 * defines only the types and the identity function — no control-plane code
 * lives here; module resolution stays ambient (the config file's own static
 * imports, resolved from the app root by the package manager).
 */
import type * as Layer from 'effect/Layer';
import type {
  AlchemyStateLayer,
  ApplicationControl,
  AssembleInput,
  Bundle,
  Lowering,
  ServiceLowering,
} from './deploy.ts';

/**
 * One extension's control-plane registry: everything the deploy pipeline may
 * look up for a node whose `extension` field names this package. `nodes` is
 * keyed by the node's within-extension ID (`node.type` / `build.type`).
 */
export interface ExtensionDescriptor {
  /** The extension's package name, e.g. "@prisma/app-cloud" — what a node's `extension` field is matched against. */
  readonly id: string;
  /** ONE registry per extension, keyed by node ID. */
  readonly nodes: Record<string, NodeControl>;
  /** Once-per-lowering hook — the application's shared infrastructure (e.g. prisma-cloud's Project). */
  readonly application?: ApplicationControl;
  /** The extension's Alchemy providers — merged across all configured extensions (config order). */
  readonly providers?: () => Layer.Layer<never>;
}

/**
 * What one registry entry can do. The `kind` discriminant is checked at every
 * lookup site against what the site needs — a resource node looked up against
 * a `service` control is an error naming (extension, type, expected kind).
 */
export type NodeControl =
  | ({ readonly kind: 'resource' } & Lowering)
  | ({ readonly kind: 'service' } & ServiceLowering)
  | { readonly kind: 'build'; assemble(input: AssembleInput): Promise<Bundle> };

/**
 * The config file's default export. `extensions` lists every extension the
 * app deploys through; `state` is the ONE state store per deploy — explicit,
 * platform-agnostic, never defaulted by an extension.
 */
export interface PrismaAppConfig {
  readonly extensions: ExtensionDescriptor[];
  readonly state: () => AlchemyStateLayer;
}

/** Typed identity — exists so `prisma-app.config.ts` gets checked against PrismaAppConfig where it is written. */
export function defineConfig(config: PrismaAppConfig): PrismaAppConfig {
  return config;
}
