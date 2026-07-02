/**
 * The execution-plane surface: the host shim and the hydrators it uses to
 * turn declared Inputs into typed clients. The control plane
 * (`@makerkit/core`) never imports it, so Loading a graph pulls in no
 * runtime/hydration code.
 */
export { runHost } from "./host.ts";
export { hydrateDescriptor } from "./hydrate.ts";
export { hydratePostgres, DATABASE_URL_ENV_VAR } from "./postgres.ts";
export type { Env } from "./postgres.ts";
