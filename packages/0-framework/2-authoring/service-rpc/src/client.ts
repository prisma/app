/**
 * The RPC kind's network adapter — the client `rpc(contract)` hydrates to.
 * POSTs JSON to `<url>/rpc/<method>` for each contract method read off
 * `contract.__cmp`. Every request carries an `Idempotency-Key` header: one
 * `crypto.randomUUID()` minted per logical call and reused byte-identically
 * across every retry of that call — never shared between two separate
 * calls. A thrown network error, a 429, or any 5xx is retried with a
 * bounded, jittered backoff; any other 4xx is not, since a malformed or
 * unauthorized request stays wrong on a second try. `serve()` already
 * validates a handler's output against the method schema before responding,
 * so the client trusts that and does not re-validate — both ends of every
 * edge are framework-provisioned. When a `serviceKey` is supplied
 * (ADR-0030), every request also carries `Authorization: Bearer
 * <serviceKey>`.
 */

import type { Contract } from '@internal/core';
import { blindCast } from '@internal/foundation/casts';
import type { Client, RpcFns } from './rpc.ts';

/**
 * A fetch-shaped transport. Defaults to the real `fetch`; a served handler
 * (`serve()`'s return value) works too — the binding does not have to be a
 * network hop.
 */
export type Transport = (req: Request) => Promise<Response>;

/**
 * The Prisma Compute ingress can close a service's first-touch connection
 * while a scale-to-zero target boots (PRO-217), so every call is retried
 * with a bounded, jittered exponential backoff — permanent protocol
 * semantics for this kind, not a compensation that goes away once that
 * platform behavior is fixed. These numbers mirror the streams module's
 * IDEMPOTENT_BACKOFF; they are reimplemented here rather than imported
 * because service-rpc is framework-layer and must not depend on
 * prisma-cloud. `maxRetries` counts retries after the first attempt, so a
 * persistently failing call sends 6 requests in total before giving up.
 *
 * Why 6 attempts covers a boot that can take up to ~22s even though the
 * backoff sums to only ~8s: the close is intermittent. On a cold start the
 * ingress usually HOLDS the connection and the request simply blocks until
 * the server is listening (there is no client-side request timeout here), so
 * a held attempt rides out the whole boot and succeeds on its own — the
 * backoff budget only governs the case where an attempt is actively closed,
 * and every close so far has been the fast (~400ms) kind. Spending six
 * attempts against that means the call fails only if it is closed six times
 * in a row, which the observed close rate makes rare. `maxDelayMs` is the
 * ceiling the doubling would be clamped to; at maxRetries:5 the last wait is
 * 4s, so the clamp never actually binds — it is kept so raising maxRetries
 * stays safe.
 */
const RETRY = {
  initialDelayMs: 250,
  multiplier: 2,
  maxDelayMs: 5_000,
  maxRetries: 5,
};

const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Whether a non-OK response is safe to retry: 429 or any 5xx, never another 4xx. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** The server's `{ error }` body, if the response has one — undefined otherwise. */
async function errorDetail(res: Response): Promise<string | undefined> {
  try {
    const body: unknown = await res.json();
    return typeof body === 'object' && body !== null && 'error' in body
      ? String(body.error)
      : undefined;
  } catch {
    return undefined;
  }
}

/** `<base>/rpc/<method>`, preserving a base URL's own path (e.g. a mount point). */
function methodUrl(base: string, method: string): string {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return new URL(`rpc/${method}`, normalizedBase).toString();
}

/**
 * Sends one logical call over `send`, retrying a thrown error, a 429, or a
 * 5xx with full-jitter backoff (a random wait between 0 and the current
 * delay, which then grows by `RETRY.multiplier` up to `RETRY.maxDelayMs`).
 * `buildRequest` is called fresh for each attempt but always carries the
 * same idempotency key — only the transport call is repeated, not the key.
 */
async function callWithRetry(
  send: Transport,
  buildRequest: () => Request,
  method: string,
): Promise<unknown> {
  let delay = RETRY.initialDelayMs;
  let retries = 0;

  for (;;) {
    let res: Response;
    try {
      res = await send(buildRequest());
    } catch (err) {
      if (retries >= RETRY.maxRetries) throw err;
      retries += 1;
      await sleep(Math.random() * delay);
      delay = Math.min(delay * RETRY.multiplier, RETRY.maxDelayMs);
      continue;
    }

    if (res.ok) return res.json();

    if (!isRetryableStatus(res.status) || retries >= RETRY.maxRetries) {
      const detail = await errorDetail(res);
      throw new Error(
        `RPC call "${method}" failed: ${res.status} ${res.statusText}` +
          (detail !== undefined ? ` — ${detail}` : ''),
      );
    }

    retries += 1;
    await sleep(Math.random() * delay);
    delay = Math.min(delay * RETRY.multiplier, RETRY.maxDelayMs);
  }
}

export function makeClient<C extends Contract<'rpc', RpcFns>>(
  contract: C,
  url: string,
  opts?: { fetch?: Transport; serviceKey?: string },
): Client<C> {
  const send = opts?.fetch ?? fetch;
  const baseHeaders: Record<string, string> = { 'content-type': 'application/json' };
  if (opts?.serviceKey !== undefined) {
    baseHeaders['Authorization'] = `Bearer ${opts.serviceKey}`;
  }
  const client: Record<string, (input: unknown) => Promise<unknown>> = {};

  for (const method of Object.keys(contract.__cmp)) {
    client[method] = async (input: unknown) => {
      const idempotencyKey = crypto.randomUUID();
      const body = JSON.stringify(input);
      return callWithRetry(
        send,
        () =>
          new Request(methodUrl(url, method), {
            method: 'POST',
            headers: { ...baseHeaders, [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
            body,
          }),
        method,
      );
    };
  }

  return blindCast<
    Client<C>,
    'client is assembled dynamically from the contract methods; each entry matches Client<C> by construction'
  >(client);
}
