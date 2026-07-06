import { Load } from "./graph.ts";
import type { ParamType, ResourceNode, ServiceNode } from "./node.ts";

/**
 * The enumerable config surface of a service — derivable from the graph
 * alone, nothing booted, no platform keys. The introspection artifact
 * (secrets marked, values absent). Physical locations are the adapter's
 * business (describe()).
 */
export interface ConfigManifestEntry {
  readonly owner: "service" | { readonly input: string };
  readonly name: string;
  readonly type: ParamType;
  readonly secret: boolean;
  readonly optional: boolean;
  readonly default?: string | number;
}

/**
 * Enumerates every config param the service's graph declares: each input's
 * connection params, then the service's own params. Pure — Loads the graph,
 * executes nothing.
 */
export function configOf(root: ServiceNode): readonly ConfigManifestEntry[] {
  const graph = Load(root);
  const entries: ConfigManifestEntry[] = [];

  for (const edge of graph.edges) {
    const entry = graph.nodes.find((n) => n.id === edge.from);
    if (entry === undefined || entry.node.kind !== "resource") continue;
    const node = entry.node as ResourceNode;
    for (const [name, param] of Object.entries(node.connection.params)) {
      entries.push({
        owner: { input: edge.input },
        name,
        type: param.type,
        secret: param.secret === true,
        optional: param.optional === true,
        ...(param.default !== undefined ? { default: param.default } : {}),
      });
    }
  }

  for (const [name, param] of Object.entries(root.params)) {
    entries.push({
      owner: "service",
      name,
      type: param.type,
      secret: param.secret === true,
      optional: param.optional === true,
      ...(param.default !== undefined ? { default: param.default } : {}),
    });
  }

  return entries;
}
