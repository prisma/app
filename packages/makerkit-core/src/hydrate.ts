/**
 * The boot-side half of the runtime split (see core-model.md § Runtime:
 * booting a service). Core's job at boot is structural only: turn a
 * concrete, typed Config into hydrated deps by calling each input's
 * connection.hydrate with its value slice. No environment read, no
 * validation, no strings — the pack's `run()` already reversed its own
 * serialization into a typed Config before calling this.
 */
import type { Config } from "./config.ts";
import type { Deps, HydratedDeps, ServiceNode } from "./node.ts";

/**
 * Given a service and a concrete typed Config, hydrate every input
 * (connection.hydrate with its typed value slice). A resource dep and a
 * connection dep hydrate through identical machinery — the handler cannot
 * tell them apart. Does not call the handler; the pack's `run()` does that
 * separately with `config.service` as ctx.
 */
export async function hydrate(root: ServiceNode, config: Config): Promise<HydratedDeps<Deps>> {
  const deps: Record<string, unknown> = {};
  for (const [name, inputNode] of Object.entries(root.inputs)) {
    const values = config.inputs[name] ?? {};
    deps[name] = await inputNode.connection.hydrate(values as never);
  }
  return deps as HydratedDeps<Deps>;
}
