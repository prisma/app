/**
 * Native oRPC's implementer owns procedure exhaustiveness and handler typing;
 * Composer's serve() owns the exhaustive mapping from exposed ports to those
 * implemented routers.
 */
import type { DependencyEnd, RunnableServiceNode } from '@internal/core';
import { dependency, service } from '@internal/core';
import { blindCast } from '@internal/foundation/casts';
import { oc } from '@orpc/contract';
import { implement } from '@orpc/server';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { type } from 'arktype';
import { expectTypeOf, test } from 'vitest';
import { contract } from '../contract.ts';
import { serve } from '../serve.ts';

const authContract = contract({
  verify: oc.input(type({ token: 'string' })).output(type({ ok: 'boolean' })),
});

interface FakeDb {
  readonly validTokens: readonly string[];
}

const db: DependencyEnd<FakeDb> = dependency({
  name: 'db',
  type: 'fake/db',
  connection: { params: {}, hydrate: () => ({ validTokens: [] }) },
});
const node = service({
  name: 'test-service',
  extension: 'test/pack',
  type: 'fake/rpc-test',
  inputs: { db },
  params: {},
  build: {
    extension: '@fake/adapter',
    type: 'fake',
    module: 'file:///test/service.ts',
    entry: 'x',
  },
  expose: { rpc: authContract },
});

declare const authService: RunnableServiceNode<
  typeof node.inputs,
  typeof node.params,
  { rpc: typeof authContract }
>;

const os = implement(authContract.router);

test('native implement() types input/output and serve() accepts the complete router', () => {
  const router = os.router({
    verify: os.verify.handler(({ input }) => {
      expectTypeOf(input).toEqualTypeOf<{ token: string }>();
      return { ok: input.token.length > 0 };
    }),
  });

  serve(authService, { rpc: router });
});

test('native implement() rejects missing and mistyped procedures', () => {
  // @ts-expect-error native oRPC requires the contract's verify procedure
  os.router({});

  os.router({
    // @ts-expect-error output ok must be boolean
    verify: os.verify.handler(() => ({ ok: 'yes' })),
  });

  os.verify.handler(({ input }) => {
    // @ts-expect-error native oRPC inferred token as string
    const token: number = input.token;
    return { ok: token > 0 };
  });
});

test('serve() requires one native router for every exposed RPC port', () => {
  // @ts-expect-error missing the exposed rpc port
  serve(authService, {});
});

declare const transformedInput: StandardSchemaV1<string, number>;
declare const transformedOutput: StandardSchemaV1<{ doubled: number }, { doubled: string }>;

const transformedContract = contract({
  transform: oc.input(transformedInput).output(transformedOutput),
});
const transformed = implement(transformedContract.router);

declare const transformedService: RunnableServiceNode<
  typeof node.inputs,
  typeof node.params,
  { rpc: typeof transformedContract }
>;

test('native handler and client honor Standard Schema transformations', () => {
  const router = transformed.router({
    transform: transformed.transform.handler(({ input }) => {
      expectTypeOf(input).toEqualTypeOf<number>();
      return { doubled: input * 2 };
    }),
  });
  serve(transformedService, { rpc: router });

  type TransformedClient = import('../rpc.ts').Client<typeof transformedContract>;
  const client = blindCast<
    TransformedClient,
    'type-only placeholder used to assert the transformed client surface'
  >(null);
  expectTypeOf(client.transform).toBeCallableWith('21');
  expectTypeOf(client.transform('21')).resolves.toEqualTypeOf<{ doubled: string }>();

  // @ts-expect-error handler returns the output schema input, not transformed client output
  transformed.transform.handler(({ input }) => ({ doubled: String(input * 2) }));
});
