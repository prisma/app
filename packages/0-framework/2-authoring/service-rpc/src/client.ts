/**
 * The client `rpc(contract)` hydrates to. POSTs JSON to `<url>/rpc/<method>`
 * per contract method. Each call carries one `Idempotency-Key`
 * (`crypto.randomUUID()`, reused across that call's retries) and, when a
 * `serviceKey` is given, `Authorization: Bearer`. A thrown error, a 429, or a
 * 5xx is retried; any other 4xx is not. `serve()` validates the response, so
 * the client does not re-validate.
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

/** Bounded jittered backoff for retrying a dropped call. `maxRetries` is retries after the first attempt. */
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
 * Sends one call over `send`, retrying a thrown error, 429, or 5xx with
 * full-jitter backoff. `buildRequest` runs per attempt but carries the same
 * idempotency key each time — only the transport call repeats, not the key.
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
