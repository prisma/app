import type { DependencyEnd } from '@internal/core';
import { describe, expectTypeOf, test } from 'vitest';
import type { StreamsClient } from '../client.ts';
import type { StreamsConfig, streamsContract } from '../contract.ts';
import { durableStreams } from '../contract.ts';

describe('durableStreams()', () => {
  test('is a DependencyEnd hydrating to a StreamsClient against streamsContract', () => {
    expectTypeOf(durableStreams()).toEqualTypeOf<
      DependencyEnd<StreamsClient, typeof streamsContract>
    >();
  });

  test('the wire binding carries the endpoint url and the minted bearer key', () => {
    expectTypeOf<StreamsConfig>().toEqualTypeOf<{
      readonly url: string;
      readonly apiKey: string;
    }>();
  });
});
