/**
 * Generates the RPC server from a service's `expose`: a web fetch handler
 * that dispatches `POST /rpc/<method>` across every exposed port, flattened
 * into one method namespace (method names must be unique across a service's
 * ports — there is no port segment in the route). `Handlers<S>` derives the
 * exhaustive, correctly-typed handler map straight off `S["expose"]` and
 * `S["load"]`'s return, so an incomplete or mistyped `serve(service,
 * handlers)` call does not compile; extra handler methods/ports are allowed
 * (width, same as a provider exposing more than a consumer requires).
 *
 * Per ADR-0030, every request is checked against the accepted service-key
 * set before dispatch: unset (never provisioned — local/test) passes
 * through; a provisioned `"[]"` (deployed, zero wired consumers) denies
 * every caller; a provisioned non-empty set requires membership via
 * `Authorization: Bearer <key>`.
 *
 * Every request must also carry an `Idempotency-Key` header — a keyless
 * request is rejected with a 400. The key drives per-method,
 * per-key dedupe: a duplicate arriving while the first call is still
 * executing single-flights onto that same execution, and a duplicate
 * arriving after a 2xx/4xx answer replays it byte-identically for a bounded
 * time. See `IdempotencyStore` below.
 */

import type { Contract, Expose, RunnableServiceNode } from '@internal/core';
import { blindCast } from '@internal/foundation/casts';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { standardValidate } from './standard-schema.ts';

// The ambient environment of whatever runtime hosts the bundle. Declared
// structurally so this entry imports no runtime's types.
declare const process: { env: Record<string, string | undefined> };

/** The reserved env var the target (slice 2) writes the accepted key set to. */
export const RPC_ACCEPTED_KEYS_ENV = 'COMPOSER_RPC_ACCEPTED_KEYS';

// biome-ignore lint/suspicious/noExplicitAny: accepts any concrete runnable service node — generics are invariant, so `any` is required (mirrors ModuleBuilder.provision in @prisma/composer).
type AnyRunnable = RunnableServiceNode<any, any, any>;

type CmpOf<C> = C extends Contract<string, infer Cmp> ? Cmp : never;

/** What a handler's optional third argument carries. Handlers may ignore it. */
export interface RpcHandlerContext {
  /** The calling client's idempotency key for this logical call — the same value on every one of its retries. */
  readonly idempotencyKey: string;
}

type HandlerFor<Fn, LoadedDeps> = Fn extends (input: infer I) => Promise<infer O>
  ? (input: I, deps: LoadedDeps, ctx: RpcHandlerContext) => Promise<O>
  : never;

/** Every exposed port's methods, turned into a handler map typed off S's own `expose` and `load()`. */
export type Handlers<S extends AnyRunnable> = {
  [Port in keyof NonNullable<S['expose']>]: {
    [M in keyof CmpOf<NonNullable<S['expose']>[Port]>]: HandlerFor<
      CmpOf<NonNullable<S['expose']>[Port]>[M],
      ReturnType<S['load']>
    >;
  };
};

interface MethodSchemas {
  readonly input: StandardSchemaV1;
  readonly output: StandardSchemaV1;
}

type RpcHandler = (input: unknown, deps: unknown, ctx: RpcHandlerContext) => Promise<unknown>;

/** A response, reduced to what the replay cache needs to reproduce it byte-identically. */
interface Outcome {
  readonly status: number;
  readonly bodyText: string;
}

function outcome(body: unknown, status = 200): Outcome {
  return { status, bodyText: JSON.stringify(body) };
}

function toResponse(o: Outcome): Response {
  return new Response(o.bodyText, {
    status: o.status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The generic message every caller-facing 500 carries — the real error goes to `console.error` instead. */
const INTERNAL_ERROR_MESSAGE = 'Internal server error';

/**
 * Internal RPC payloads are small, schema-validated records, not file
 * uploads — 1 MiB comfortably covers any real one while bounding the
 * worst-case memory a single slow request can hold open on one instance.
 */
export const MAX_BODY_BYTES = 1_048_576;

class RequestBodyTooLargeError extends Error {}

/**
 * Reads `req`'s body as text, aborting once more than `maxBytes` has
 * actually been read off the stream — never trusting `content-length`,
 * which is caller-supplied and may be absent or wrong.
 */
async function readBoundedBody(req: Request, maxBytes: number): Promise<string> {
  const reader = req.body?.getReader();
  if (reader === undefined) return '';

  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RequestBodyTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

/**
 * How many completed answers the replay cache holds across every method at
 * once, LRU-evicted once full. This cache is resident in every RPC
 * provider process, so its bound has to be a fixed, small amount of memory
 * rather than grow with traffic: 1000 entries — each a small JSON body plus
 * bookkeeping — comfortably fits in a few hundred KB, well past the
 * concurrent in-flight key count one instance of an internal RPC provider
 * realistically sees inside the replay window.
 */
export const REPLAY_CACHE_MAX_ENTRIES = 1000;

/** How long a completed 2xx/4xx answer stays replayable for a repeated key. */
const REPLAY_TTL_MS = 60_000;

type CacheEntry =
  | { readonly kind: 'pending'; readonly promise: Promise<Outcome> }
  | { readonly kind: 'completed'; readonly outcome: Outcome; readonly completedAt: number };

/**
 * Per-method, per-idempotency-key dedupe. A duplicate key arriving while
 * the first call for it is still executing single-flights onto that same
 * promise, so the handler runs exactly once. A completed 2xx/4xx answer (an
 * answer, not a retryable outcome) replays byte-identically for
 * REPLAY_TTL_MS; a 5xx is never kept, since 5xx is exactly the outcome a
 * retry exists to re-execute.
 *
 * Storage is keyed by method first, then by idempotency key, so a lookup
 * for method B can only ever find B's own entries — a replay is
 * structurally incapable of answering a different method, even if a caller
 * (buggy or malicious) reuses one key across two different methods.
 */
class IdempotencyStore {
  private readonly byMethod = new Map<string, Map<string, CacheEntry>>();
  // Global LRU order across every method's completed entries, oldest first;
  // insertion order in a Map is exploited here rather than a separate
  // linked list — re-inserting a key moves it to the end.
  private readonly lruOrder = new Map<string, { readonly method: string; readonly key: string }>();

  async dispatch(method: string, key: string, run: () => Promise<Outcome>): Promise<Outcome> {
    const bucket = this.bucketFor(method);
    const existing = bucket.get(key);

    if (existing?.kind === 'pending') {
      return existing.promise;
    }
    if (existing?.kind === 'completed') {
      if (Date.now() - existing.completedAt < REPLAY_TTL_MS) {
        this.touch(method, key);
        return existing.outcome;
      }
      bucket.delete(key);
      this.lruOrder.delete(this.lruKey(method, key));
    }

    const promise = run();
    bucket.set(key, { kind: 'pending', promise });

    let result: Outcome;
    try {
      result = await promise;
    } catch (err) {
      bucket.delete(key);
      throw err;
    }

    if (result.status >= 500) {
      bucket.delete(key); // retryable outcome — a retry must re-execute
    } else {
      bucket.set(key, { kind: 'completed', outcome: result, completedAt: Date.now() });
      this.touch(method, key);
    }
    return result;
  }

  private bucketFor(method: string): Map<string, CacheEntry> {
    let bucket = this.byMethod.get(method);
    if (bucket === undefined) {
      bucket = new Map();
      this.byMethod.set(method, bucket);
    }
    return bucket;
  }

  private lruKey(method: string, key: string): string {
    return `${method} ${key}`;
  }

  /** Marks (method, key) most-recently-used, evicting the oldest completed entry once over the bound. */
  private touch(method: string, key: string): void {
    const lruKey = this.lruKey(method, key);
    this.lruOrder.delete(lruKey);
    this.lruOrder.set(lruKey, { method, key });

    if (this.lruOrder.size > REPLAY_CACHE_MAX_ENTRIES) {
      const oldestKey = this.lruOrder.keys().next().value;
      const oldest = oldestKey === undefined ? undefined : this.lruOrder.get(oldestKey);
      if (oldestKey !== undefined && oldest !== undefined) {
        this.lruOrder.delete(oldestKey);
        this.byMethod.get(oldest.method)?.delete(oldest.key);
      }
    }
  }
}

/** The provisioned accepted key set, or undefined when the deploy never provisioned one (local/test — enforcement off). */
function acceptedKeys(): readonly string[] | undefined {
  const raw = process.env[RPC_ACCEPTED_KEYS_ENV];
  if (raw === undefined || raw === '') return undefined; // unprovisioned → pass through

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return []; // provisioned but unreadable → deny all
  }
  return Array.isArray(parsed) && parsed.every((key): key is string => typeof key === 'string')
    ? parsed
    : [];
}

/**
 * Length-independent constant-time string equality — no early exit on the
 * first mismatched character or on a length difference, so a caller cannot
 * time its way toward a valid key. No `node:crypto`, to keep this module
 * runtime-agnostic.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i++) {
    diff |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
  }
  return diff === 0;
}

/** Whether `presented` is a member of `accepted` — always compares against every key. */
function isAcceptedKey(presented: string, accepted: readonly string[]): boolean {
  let matched = false;
  for (const key of accepted) {
    matched = constantTimeEquals(presented, key) || matched;
  }
  return matched;
}

const BEARER_PREFIX = 'Bearer ';

/** The bearer token on `Authorization`, or `''` if the header is missing or malformed. */
function bearerToken(req: Request): string {
  const header = req.headers.get('authorization');
  return header?.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : '';
}

const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/**
 * Flattens every exposed port's methods into one method → {schemas, handler}
 * table. RPC dispatch is flat (`/rpc/<method>`), so a method name exposed by
 * more than one port is a construction-time error, as is a missing handler.
 */
function methodTable(
  expose: Expose,
  handlers: Record<string, Record<string, RpcHandler>>,
): Map<string, MethodSchemas & { handler: RpcHandler }> {
  const table = new Map<string, MethodSchemas & { handler: RpcHandler }>();

  for (const [port, contract] of Object.entries(expose)) {
    const portHandlers = handlers[port] ?? {};
    for (const [method, fn] of Object.entries(contract.__cmp)) {
      if (table.has(method)) {
        throw new Error(
          `serve(): method "${method}" is exposed by more than one port — RPC dispatch is flat ` +
            "(POST /rpc/<method>), so method names must be unique across a service's exposed ports.",
        );
      }
      const handler = portHandlers[method];
      if (handler === undefined) {
        throw new Error(`serve(): no handler supplied for exposed method "${port}.${method}".`);
      }
      const { input, output } = blindCast<
        MethodSchemas,
        'rpc() stores the method input/output Standard Schemas on the function value; the Cmp type models only the call signature'
      >(fn);
      table.set(method, { input, output, handler });
    }
  }

  return table;
}

/**
 * Routes `POST /rpc/<method>`: checks the service key, requires an
 * Idempotency-Key, single-flights/replays through `IdempotencyStore`, and —
 * per call — parses JSON within the body cap, validates input, calls the
 * handler with `service.load()`'s deps plus `{ idempotencyKey }`, validates
 * the output, and responds JSON. A handler or output-validation failure
 * masks its message behind a generic 500 and logs the real error; an
 * unknown method or invalid input is a 4xx. `load()` is called exactly
 * once, here, before the handler ever runs.
 */
export function serve<S extends AnyRunnable, H extends Handlers<S>>(
  service: S,
  handlers: H,
): (req: Request) => Promise<Response> {
  const table = methodTable(
    service.expose ?? {},
    blindCast<
      Record<string, Record<string, RpcHandler>>,
      'Handlers<S> is the exhaustive typed handler map; methodTable indexes it by the runtime port/method strings'
    >(handlers),
  );
  const deps = service.load();
  const idempotency = new IdempotencyStore();

  return async (req: Request): Promise<Response> => {
    const accepted = acceptedKeys();
    if (accepted !== undefined && !isAcceptedKey(bearerToken(req), accepted)) {
      return toResponse(outcome({ error: 'Unauthorized: missing or invalid service key' }, 401));
    }

    const { pathname } = new URL(req.url);
    const methodName = /^\/rpc\/([^/]+)$/.exec(pathname)?.[1];
    if (methodName === undefined) {
      return toResponse(outcome({ error: `Not found: ${pathname}` }, 404));
    }

    const method = table.get(methodName);
    if (method === undefined) {
      return toResponse(outcome({ error: `Unknown RPC method "${methodName}"` }, 404));
    }
    if (req.method !== 'POST') {
      return toResponse(outcome({ error: `Method "${methodName}" requires POST` }, 405));
    }

    const idempotencyKey = req.headers.get(IDEMPOTENCY_KEY_HEADER.toLowerCase());
    if (idempotencyKey === null || idempotencyKey === '') {
      return toResponse(
        outcome({ error: `Missing required "${IDEMPOTENCY_KEY_HEADER}" header` }, 400),
      );
    }

    const ctx: RpcHandlerContext = { idempotencyKey };

    const run = async (): Promise<Outcome> => {
      let bodyText: string;
      try {
        bodyText = await readBoundedBody(req, MAX_BODY_BYTES);
      } catch (err) {
        if (err instanceof RequestBodyTooLargeError) {
          return outcome({ error: `Request body exceeds the ${MAX_BODY_BYTES}-byte limit` }, 413);
        }
        throw err;
      }

      let body: unknown;
      try {
        body = JSON.parse(bodyText);
      } catch {
        return outcome({ error: 'Request body must be JSON' }, 400);
      }

      let input: unknown;
      try {
        input = await standardValidate(method.input, body);
      } catch (err) {
        return outcome({ error: err instanceof Error ? err.message : String(err) }, 400);
      }

      try {
        const result = await method.handler(input, deps, ctx);
        let output: unknown;
        try {
          output = await standardValidate(method.output, result);
        } catch (err) {
          console.error(
            `serve(): handler for "${methodName}" returned output that failed schema validation — this is a provider bug:`,
            err,
          );
          return outcome({ error: INTERNAL_ERROR_MESSAGE }, 500);
        }
        return outcome(output);
      } catch (err) {
        console.error(`serve(): handler for "${methodName}" threw:`, err);
        return outcome({ error: INTERNAL_ERROR_MESSAGE }, 500);
      }
    };

    const result = await idempotency.dispatch(methodName, idempotencyKey, run);
    return toResponse(result);
  };
}
