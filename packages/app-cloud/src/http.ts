import type { DependencyEnd } from '@prisma/app';
import { dependency } from '@prisma/app';

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
export const http = <C = HttpClient>(opts: {
  name: string;
  client?: (cfg: { url: string }) => C;
}): DependencyEnd<C> =>
  dependency({
    name: opts.name,
    type: 'http',
    connection: {
      params: { url: { type: 'string' } },
      hydrate: (v) => (opts.client ?? defaultHttpClient)({ url: v.url }) as C,
    },
  });
