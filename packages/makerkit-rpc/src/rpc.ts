/**
 * `rpc()` types one method as a concrete `(input) => Promise<output>` — the
 * shape that makes Contract's plain assignability check apply real function
 * variance. Input/output are Standard Schema validators (arktype the
 * canonical one). The runtime value carries the two schemas for a later
 * unit's serve()/client to read back out; nothing calls it as a function yet.
 */
import type { Contract } from '@makerkit/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';

export function rpc<I extends StandardSchemaV1, O extends StandardSchemaV1>(m: {
  input: I;
  output: O;
}): (input: StandardSchemaV1.InferInput<I>) => Promise<StandardSchemaV1.InferOutput<O>> {
  return m as unknown as (
    input: StandardSchemaV1.InferInput<I>,
  ) => Promise<StandardSchemaV1.InferOutput<O>>;
}

/** The typed client a consumer's `rpc(contract)` dependency hydrates to. */
export type Client<C> = C extends Contract<string, infer Cmp> ? Cmp : never;
