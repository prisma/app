/**
 * The RPC kind's network adapter — the client `rpc(contract)` hydrates to.
 * Reads each method's Standard Schema pair off the contract's `__cmp[method]`
 * runtime value (rpc()'s `{ input, output }`), POSTs JSON to
 * `<url>/rpc/<method>`, and validates the response against the output schema
 * before returning it (a provider can be typed-compatible and still lie at
 * runtime — this is the per-call layer that catches that).
 */
import type { Contract } from '@makerkit/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Client, RpcFns } from './rpc.ts';
import { standardValidate } from './standard-schema.ts';

/** rpc()'s runtime shape for one method: `{ input, output }` wearing a function's type. */
interface MethodSchemas {
  readonly input: StandardSchemaV1;
  readonly output: StandardSchemaV1;
}

/**
 * A fetch-shaped transport. Defaults to the real `fetch`; a served handler
 * (`serve()`'s return value) works too — the binding does not have to be a
 * network hop.
 */
export type Transport = (req: Request) => Promise<Response>;

export function makeClient<C extends Contract<'rpc', RpcFns>>(
  contract: C,
  url: string,
  opts?: { fetch?: Transport },
): Client<C> {
  const send = opts?.fetch ?? fetch;
  const client: Record<string, (input: unknown) => Promise<unknown>> = {};

  for (const [method, schemas] of Object.entries(
    contract.__cmp as unknown as Record<string, MethodSchemas>,
  )) {
    client[method] = async (input: unknown) => {
      const res = await send(
        new Request(new URL(`rpc/${method}`, url).toString(), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }),
      );
      if (!res.ok) {
        throw new Error(`RPC call "${method}" failed: ${res.status} ${res.statusText}`);
      }
      return standardValidate(schemas.output, await res.json());
    };
  }

  return client as Client<C>;
}
