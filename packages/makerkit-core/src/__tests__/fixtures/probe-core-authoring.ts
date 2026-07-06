// Bundle probe for the import-split guard: uses core's authoring entry the way
// a user service module would, with real value usage so nothing tree-shakes away.
import { configOf, Load, resource, service } from "../../index.ts";

const db = resource({
  type: "probe/db",
  connection: {
    config: [{ name: "url", secret: true }],
    hydrate: (cfg) => ({ url: cfg.url }),
  },
});

const app = service({
  type: "probe/app",
  inputs: { db },
  host: {
    channel: "env",
    key: (input, field) => `${input}_${field}`.toUpperCase(),
    context: [{ name: "port", key: "PORT", default: 3000 }],
  },
  handler: ({ db: client }) => client,
});

export const graph = Load(app, { id: "probe" });
export const manifest = configOf(app);
