/**
 * The authoring vocabulary for Prisma Cloud — nodes carrying their
 * connection/host knowledge. The driver is a parameter, so the pack ships
 * none and the client type is inferred. Imports @makerkit/core and nothing
 * else; the pack never reads an environment (core resolves config through
 * the HostConvention data below).
 */
import { resource, service } from "@makerkit/core";
import type { Deps, ResourceNode, ServiceHandler, ServiceNode } from "@makerkit/core";

export interface PostgresConfig {
  readonly url: string;
}

/**
 * A Postgres dependency, served on Prisma Cloud by the project's database.
 * The app supplies the client factory; C is inferred from its return type.
 */
export const postgres = <C>(opts: { client: (config: PostgresConfig) => C }): ResourceNode<C> =>
  resource<C>({
    type: "prisma-cloud/postgres",
    connection: {
      config: [{ name: "url", secret: true }],
      hydrate: (cfg) => opts.client({ url: cfg.url }),
    },
  });

/**
 * A Prisma Compute service: inputs + handler, inert until run by the host.
 * Carries Compute's config convention as data — core does the resolving.
 */
export const compute = <D extends Deps>(deps: D, handler: ServiceHandler<D>): ServiceNode<D> =>
  service({
    type: "prisma-cloud/compute",
    inputs: deps,
    handler,
    host: {
      channel: "env",
      // Compute's convention: the project default DB arrives as DATABASE_URL
      // (per-input naming arrives with multiple databases).
      key: (_input, field) => (field === "url" ? "DATABASE_URL" : field.toUpperCase()),
      context: [{ name: "port", key: "PORT", default: 3000 }],
    },
  });
