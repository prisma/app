/**
 * The `s3-store` node kind's descriptor (§ 5): compute's service lowering with
 * EXTENDED deploy outputs. provision/package are compute's unchanged; serialize
 * and deploy delegate to compute's then surface the four consumer-visible
 * `S3Config` fields — `bucket` from the service's own param, `accessKeyId` /
 * `secretAccessKey` from the wired `s3-credentials` resource (reachable in the
 * built Config as `inputs.credentials`). A consumer wiring the `store` port into
 * an `s3()` slot resolves those fields by NAME from these outputs.
 */

import type { NodeDescriptor } from '@internal/core/config';
import * as Effect from 'effect/Effect';
import { computeDescriptor } from './compute.ts';
import type { ResolvedCloudOptions } from './shared.ts';

export function s3StoreDescriptor(o: ResolvedCloudOptions): NodeDescriptor {
  const base = computeDescriptor(o);
  if (base.kind !== 'service') {
    throw new Error('computeDescriptor must be a service descriptor');
  }

  return {
    kind: 'service' as const,
    provision: base.provision,
    package: base.package,

    // compute's env-var writes stay unchanged (the storage service reads db,
    // credentials, and bucket through them); we additionally surface the four
    // consumer-facing fields so deploy can hand them to consumers.
    serialize: (ctx, provisioned, config) =>
      Effect.gen(function* () {
        const serialized = yield* base.serialize(ctx, provisioned, config);
        const credentials = config.inputs['credentials'] ?? {};
        return {
          outputs: {
            ...serialized.outputs,
            bucket: config.service['bucket'],
            accessKeyId: credentials['accessKeyId'],
            secretAccessKey: credentials['secretAccessKey'],
          },
        };
      }),

    deploy: (ctx, provisioned, artifact, serialized) =>
      Effect.gen(function* () {
        const deployed = yield* base.deploy(ctx, provisioned, artifact, serialized);
        return {
          outputs: {
            ...deployed.outputs,
            bucket: serialized.outputs['bucket'],
            accessKeyId: serialized.outputs['accessKeyId'],
            secretAccessKey: serialized.outputs['secretAccessKey'],
          },
        };
      }),
  };
}
