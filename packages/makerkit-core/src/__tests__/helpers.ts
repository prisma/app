import type { ConfigField, Connection, HostConvention } from "../node.ts";

/** A test connection: declared fields + a recording/simple hydrate. */
export const conn = <C>(
  fields: readonly ConfigField[],
  make: (cfg: Record<string, string>) => C,
): Connection<C> => ({ config: fields, hydrate: make });

/** A test host convention: INPUT_FIELD env keys, PORT context with default 3000. */
export const testHost: HostConvention = {
  channel: "env",
  key: (input, field) => `${input}_${field}`.toUpperCase(),
  context: [{ name: "port", key: "PORT", default: 3000 }],
};
