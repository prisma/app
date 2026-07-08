/**
 * `rpc()` is the RPC kind's single entry, overloaded by what it's given. A
 * `{ input, output }` pair types one contract method as a concrete
 * `(input) => Promise<output>` — the shape that makes Contract's plain
 * assignability apply real function variance. Input/output are Standard
 * Schema validators (arktype the canonical one); the runtime value carries
 * the two schemas for serve()/the client to read back out.
 *
 * A Contract instead types a dependency's connection end — the typed sibling
 * of `http()`, same `{ url }` param, hydrating to the typed client `Client<C>`
 * over the network binding in client.ts.
 */
import type { Contract } from '@makerkit/core';
import { type ConnectionEnd, connectionEnd } from '@makerkit/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { makeClient } from './client.ts';

/** The concrete function-map bound every RPC Contract's Cmp must fit. */
// biome-ignore lint/suspicious/noExplicitAny: concrete function-map bound, matches contract()'s own (see contract.ts).
export type RpcFns = Record<string, (input: any) => Promise<any>>;

export function rpc<I extends StandardSchemaV1, O extends StandardSchemaV1>(m: {
  input: I;
  output: O;
}): (input: StandardSchemaV1.InferInput<I>) => Promise<StandardSchemaV1.InferOutput<O>>;
export function rpc<C extends Contract<'rpc', RpcFns>>(contract: C): ConnectionEnd<Client<C>>;
export function rpc(
  arg: { input: StandardSchemaV1; output: StandardSchemaV1 } | Contract<'rpc', RpcFns>,
): unknown {
  if (!isRpcContract(arg)) return arg;

  return connectionEnd({
    type: 'rpc',
    connection: {
      params: { url: { type: 'string' } },
      hydrate: ({ url }) => makeClient(arg, url),
    },
  });
}

function isRpcContract(value: unknown): value is Contract<'rpc', RpcFns> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'rpc' &&
    '__cmp' in value &&
    'satisfies' in value
  );
}

/** The typed client a consumer's `rpc(contract)` dependency hydrates to. */
export type Client<C> = C extends Contract<string, infer Cmp> ? Cmp : never;
