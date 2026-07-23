/**
 * The `./compose-fetch` subpath: first-party only, deliberately kept off the
 * published API (`@prisma/composer/service-rpc` re-exports the root barrel,
 * not this file). Its input shape is expected to change when services gain
 * first-class multi-port routing, so no external consumer should depend on it
 * yet. Implementation lives in `../compose-fetch.ts`.
 */
export * from '../compose-fetch.ts';
