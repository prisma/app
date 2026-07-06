/**
 * The boot pipeline. Core owns config management end to end: enumerate the
 * service's config surface (configOf), resolve each field
 * (override ?? env[key] ?? default), validate BEFORE any hydrate, hydrate
 * each connection with its resolved slice, build the RuntimeContext from the
 * resolved context fields, call the handler. Imports nothing.
 */
import { configOf, type ConfigManifestEntry } from "../config.ts";
import { Load } from "../graph.ts";
import type { ResourceNode, RuntimeContext, ServiceNode } from "../node.ts";

export type Env = Record<string, string | undefined>;

export interface RunHostOptions {
  /** Source override (tests) — defaults to the ambient environment. */
  readonly env?: Env;
  /** Field-level overrides, keyed "input.field" / "context.field". */
  readonly config?: Record<string, string>;
}

/** Names every missing key at once — validation happens before any hydrate. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

// The ambient environment of whatever runtime hosts the bundle. Declared
// structurally so this entry imports no runtime's types.
declare const process: { readonly env: Env };

const overrideKey = (entry: ConfigManifestEntry): string =>
  entry.input !== undefined ? `${entry.input}.${entry.field}` : `context.${entry.field}`;

/**
 * Load(root) → configOf → resolve each entry → validate (ALL missing required
 * fields reported in one ConfigError — Load-before-Hydrate applied to config)
 * → per input: connection.hydrate(resolvedSlice) → root.run(deps, context).
 * This default `env` read is the only place the ambient environment enters
 * the system.
 */
export function runHost(root: ServiceNode, opts?: RunHostOptions): unknown {
  const graph = Load(root);
  const manifest = configOf(root);
  const env = opts?.env ?? process.env;

  const resolved = new Map<string, string | number>();
  const missing: string[] = [];

  for (const entry of manifest) {
    const value = opts?.config?.[overrideKey(entry)] ?? env[entry.key] ?? entry.default;
    if (value === undefined) {
      if (!entry.optional) missing.push(`${entry.key} (${overrideKey(entry)})`);
      continue;
    }
    resolved.set(overrideKey(entry), value);
  }

  if (missing.length > 0) {
    throw new ConfigError(`Missing required config: ${missing.join(", ")}.`);
  }

  const deps: Record<string, unknown> = {};
  const byId = new Map(graph.nodes.map((entry) => [entry.id, entry]));
  for (const edge of graph.edges) {
    const node = byId.get(edge.from)?.node as ResourceNode;
    const slice: Record<string, string> = {};
    for (const field of node.connection.config) {
      const value = resolved.get(`${edge.input}.${field.name}`);
      if (value !== undefined) slice[field.name] = String(value);
    }
    deps[edge.input] = node.connection.hydrate(slice);
  }

  const context: Record<string, unknown> = {};
  for (const field of root.host.context) {
    const value = resolved.get(`context.${field.name}`);
    // RuntimeContext fields are numeric today (port); env delivers strings. A
    // non-numeric resolved value falls back to the declared default.
    const parsed = typeof value === "string" ? Number(value) : value;
    context[field.name] =
      typeof parsed === "number" && Number.isFinite(parsed) ? parsed : field.default;
  }

  return root.run(deps as Parameters<typeof root.run>[0], context as unknown as RuntimeContext);
}
