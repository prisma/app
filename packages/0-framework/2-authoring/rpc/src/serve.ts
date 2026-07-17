/**
 * Mounts native oRPC routers for a Composer service. oRPC owns procedures,
 * middleware, validation, typed errors, codecs, and dispatch. Composer owns
 * topology-to-router verification, per-edge authorization, and body limits.
 */

import type { RunnableServiceNode } from '@internal/core';
import { blindCast } from '@internal/foundation/casts';
import { ORPCError } from '@orpc/client';
import {
  type AnyRouter,
  type ContractedRouter,
  type DefaultInitialContext,
  getHiddenRouterContract,
  walkProcedureContractsSync,
} from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';
import { RequestLimitHandlerPlugin } from '@orpc/server/plugins';
import { type AnyRpcContract, isRpcContract, type RpcContract } from './contract.ts';

// The ambient environment of whatever runtime hosts the bundle. Declared
// structurally so this entry imports no runtime-specific types.
declare const process: { env: Record<string, string | undefined> };

/** The reserved env var the target writes the accepted key set to. */
export const RPC_ACCEPTED_KEYS_ENV = 'COMPOSER_RPC_ACCEPTED_KEYS';

/** The default maximum encoded request body: one mebibyte. */
export const DEFAULT_RPC_MAX_BODY_SIZE = 1024 * 1024;

export interface ServeOptions {
  /** Mount path for the RPC router. @default '/rpc' */
  readonly prefix?: `/${string}`;
  /** Maximum encoded request body in bytes. @default 1048576 */
  readonly maxBodySize?: number;
}

// biome-ignore lint/suspicious/noExplicitAny: accepts every concrete runnable node; its generics are invariant.
type AnyRunnable = RunnableServiceNode<any, any, any>;

type RouterFor<C> =
  C extends RpcContract<infer R> ? ContractedRouter<R, DefaultInitialContext> : never;

/** One native implemented oRPC router for every RPC port exposed by a service. */
export type Routers<S extends AnyRunnable> = {
  [Port in keyof NonNullable<S['expose']> as NonNullable<S['expose']>[Port] extends AnyRpcContract
    ? Port
    : never]: RouterFor<NonNullable<S['expose']>[Port]>;
};

/** The provisioned accepted key set, or undefined in unprovisioned local/test runs. */
function acceptedKeys(): readonly string[] | undefined {
  const raw = process.env[RPC_ACCEPTED_KEYS_ENV];
  if (raw === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return Array.isArray(parsed) &&
    parsed.every((key): key is string => typeof key === 'string' && key.length > 0)
    ? parsed
    : [];
}

/** Runtime-agnostic length-independent equality for service capability keys. */
function constantTimeEquals(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
  }
  return diff === 0;
}

function isAcceptedKey(presented: string, accepted: readonly string[]): boolean {
  let matched = false;
  for (const key of accepted) {
    matched = constantTimeEquals(presented, key) || matched;
  }
  return matched;
}

const BEARER_PREFIX = 'Bearer ';

function bearerToken(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header.at(-1) : header;
  return value?.startsWith(BEARER_PREFIX) ? value.slice(BEARER_PREFIX.length) : '';
}

function validateOptions(options: ServeOptions | undefined): Required<ServeOptions> {
  const prefix = options?.prefix ?? '/rpc';
  const maxBodySize = options?.maxBodySize ?? DEFAULT_RPC_MAX_BODY_SIZE;
  if (!prefix.startsWith('/')) {
    throw new Error('serve(): prefix must start with "/".');
  }
  if (!Number.isSafeInteger(maxBodySize) || maxBodySize <= 0) {
    throw new Error('serve(): maxBodySize must be a positive safe integer.');
  }
  return { prefix, maxBodySize };
}

interface MountedRouter {
  readonly port: string;
  readonly handler: RPCHandler<DefaultInitialContext>;
}

function procedurePathKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

function procedureWirePath(path: readonly string[]): string {
  return path.map(encodeURIComponent).join('/');
}

function mountRouters<S extends AnyRunnable>(
  service: S,
  routers: Routers<S>,
  maxBodySize: number,
): MountedRouter[] {
  const mounted: MountedRouter[] = [];
  const paths = new Map<string, string>();
  const routersByPort = blindCast<
    Record<string, AnyRouter | undefined>,
    'Routers<S> is keyed by the string names of the service RPC ports'
  >(routers);

  for (const [port, exposedContract] of Object.entries(service.expose ?? {})) {
    if (!isRpcContract(exposedContract)) continue;

    const router = routersByPort[port];
    if (router === undefined) {
      throw new Error(`serve(): no native oRPC router supplied for exposed port "${port}".`);
    }
    if (getHiddenRouterContract(router) !== exposedContract.router) {
      throw new Error(
        `serve(): router for port "${port}" was not implemented from that port's exact contract.router.`,
      );
    }

    walkProcedureContractsSync(exposedContract.router, (_procedure, path) => {
      const key = procedurePathKey(path);
      const owner = paths.get(key);
      if (owner !== undefined) {
        throw new Error(
          `serve(): procedure path "${procedureWirePath(path)}" is exposed by both "${owner}" and "${port}"; ` +
            "paths must be unique across a service's RPC ports.",
        );
      }
      paths.set(key, port);
    });

    const declaredPaths = new Set(
      [...paths.entries()].filter(([, owner]) => owner === port).map(([path]) => path),
    );

    mounted.push({
      port,
      handler: new RPCHandler(router, {
        // `ContractedRouter` deliberately permits richer structural router
        // types. Only publish procedures declared by this topology contract,
        // even if an implementation object carries additional procedures.
        filter: (_procedure, path) => declaredPaths.has(procedurePathKey(path)),
        plugins: [new RequestLimitHandlerPlugin({ maxBodySize })],
        interceptors: [
          async ({ next, request }) => {
            const accepted = acceptedKeys();
            const presented = bearerToken(request.headers['authorization']);
            if (accepted !== undefined && !isAcceptedKey(presented, accepted)) {
              throw new ORPCError('UNAUTHORIZED', {
                message: 'Unauthorized: missing or invalid service key',
              });
            }
            if (request.method !== 'POST') {
              throw new ORPCError('METHOD_NOT_SUPPORTED', {
                message: 'RPC procedures require POST',
              });
            }
            return next();
          },
        ],
      }),
    });
  }

  return mounted;
}

function notFound(req: Request): Response {
  const { pathname } = new URL(req.url);
  return Response.json({ error: `Not found: ${pathname}` }, { status: 404 });
}

/**
 * Returns a Web Fetch handler for the supplied native oRPC routers. Matching
 * and authorization happen before body decoding. Nested oRPC paths remain
 * intact below the `/rpc` prefix.
 */
export function serve<S extends AnyRunnable>(
  service: S,
  routers: Routers<NoInfer<S>>,
  options?: ServeOptions,
): (req: Request) => Promise<Response> {
  const { prefix, maxBodySize } = validateOptions(options);
  const mounted = mountRouters(service, routers, maxBodySize);

  return async (req: Request): Promise<Response> => {
    for (const { handler } of mounted) {
      const result = await handler.handle(req, { context: {}, prefix });
      if (result.matched) return result.response;
    }
    return notFound(req);
  };
}
