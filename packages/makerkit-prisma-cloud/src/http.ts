import { connectionEnd } from "@makerkit/core";
import type { ConnectionEnd } from "@makerkit/core";

/** A service-to-service dependency's default client: a thin URL-anchored fetch wrapper. */
export interface HttpClient {
  readonly url: string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

const defaultHttpClient = (cfg: { url: string }): HttpClient => ({
  url: cfg.url,
  fetch: (path, init) => fetch(new URL(path, cfg.url), init),
});

/**
 * A service-to-service dependency. Default client is a thin URL-anchored
 * fetch wrapper (fetch is standard across runtimes — no driver, no runtime
 * coupling); an app factory can replace it. The typed generated client
 * arrives with the interface primitive (a later extension point).
 */
export const http = <C = HttpClient>(opts?: { client?: (cfg: { url: string }) => C }): ConnectionEnd<C> =>
  connectionEnd({
    type: "prisma-cloud/http",
    connection: {
      params: { url: { type: "string" } },
      hydrate: (v) => (opts?.client ?? defaultHttpClient)({ url: v.url }) as C,
    },
  });
