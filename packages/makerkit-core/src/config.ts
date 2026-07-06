import { Load } from "./graph.ts";
import type { ResourceNode, ServiceNode } from "./node.ts";

/**
 * The enumerable config surface of a service — derivable from the graph
 * alone, nothing booted. This is the introspection artifact (secrets marked,
 * values absent).
 */
export interface ConfigManifestEntry {
  /** Absent for context fields. */
  readonly input?: string;
  readonly field: string;
  readonly channel: "env";
  readonly key: string;
  readonly secret: boolean;
  readonly default?: string | number;
  readonly optional: boolean;
}

/**
 * Enumerates every config field the service's graph declares: each input's
 * connection fields, addressed through the service's HostConvention rule,
 * plus the convention's context fields (addressed by their own key). Pure —
 * Loads the graph, executes nothing.
 */
export function configOf(root: ServiceNode): readonly ConfigManifestEntry[] {
  const graph = Load(root);
  const host = root.host;
  const entries: ConfigManifestEntry[] = [];

  for (const edge of graph.edges) {
    const entry = graph.nodes.find((n) => n.id === edge.from);
    if (entry === undefined || entry.node.kind !== "resource") continue;
    const node = entry.node as ResourceNode;
    for (const field of node.connection.config) {
      entries.push({
        input: edge.input,
        field: field.name,
        channel: host.channel,
        key: host.key(edge.input, field.name),
        secret: field.secret === true,
        optional: field.optional === true,
      });
    }
  }

  for (const field of host.context) {
    entries.push({
      field: field.name,
      channel: host.channel,
      key: field.key,
      secret: false,
      ...(field.default !== undefined ? { default: field.default } : {}),
      // A context field with a default can always resolve.
      optional: field.default !== undefined,
    });
  }

  return entries;
}
