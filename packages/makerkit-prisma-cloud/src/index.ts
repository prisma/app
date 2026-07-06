/**
 * The authoring vocabulary for Prisma Cloud — nodes carrying their
 * connection and config knowledge. The driver is a parameter, so the pack
 * ships none and the client type is inferred. Imports @makerkit/core and
 * nothing else. The semantic↔physical config mapping is private to the
 * pack's ConfigAdapter below — the single sanctioned environment reader for
 * this platform.
 */
import { resource, service } from "@makerkit/core";
import type {
  ConfigAdapter,
  Deps,
  ResourceNode,
  ServiceHandler,
  ServiceNode,
} from "@makerkit/core";

export interface PostgresConfig {
  readonly url: string;
}

/**
 * A Postgres dependency, served on Prisma Cloud by the project's database.
 * The app supplies the client factory; C is inferred from its return type.
 */
export const postgres = <C>(opts: {
  client: (config: PostgresConfig) => C | Promise<C>;
}): ResourceNode<C> =>
  resource({
    type: "prisma-cloud/postgres",
    connection: {
      params: { url: { type: "string", secret: true } },
      // v: { url: string } — enforced by the declaration.
      hydrate: (v) => opts.client({ url: v.url }),
    },
  });

const computeParams = { port: { type: "number", default: 3000 } } as const;

/**
 * A Prisma Compute service: inputs + handler, inert until run by the host.
 * Declares its own params (port) — handlers receive ({ ...deps }, { port }).
 */
export const compute = <D extends Deps>(
  deps: D,
  handler: ServiceHandler<D, typeof computeParams>,
): ServiceNode<D, typeof computeParams> =>
  service({
    type: "prisma-cloud/compute",
    inputs: deps,
    params: computeParams,
    adapter: computeAdapter,
    handler,
  });

// The platform adapter — the pack's single environment reader. The semantic↔
// physical mapping (url ↔ DATABASE_URL, port ↔ PORT; per-input naming when
// multiple databases arrive) lives HERE, private to the pack.
const physicalKey = (name: string): string => (name === "url" ? "DATABASE_URL" : name.toUpperCase());

// The ambient environment of whatever runtime hosts the bundle. Declared
// structurally so this entry imports no runtime's types.
declare const process: { readonly env: Record<string, string | undefined> };

const computeAdapter: ConfigAdapter = {
  async get(requests) {
    const values: Record<string, string> = {};
    for (const request of requests) {
      const raw = process.env[physicalKey(request.name)];
      if (raw !== undefined) values[request.id] = raw;
    }
    return values;
  },
  async describe(request) {
    return { location: `env:${physicalKey(request.name)}` };
  },
};
