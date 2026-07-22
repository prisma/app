/** The `auth-secret` node kind's descriptor: mint one stable instance secret per module-provisioned auth-secret resource. */

import type { NodeDescriptor } from '@internal/core/config';
import type { Lowering } from '@internal/core/deploy';
import * as Effect from 'effect/Effect';
import { AuthSecret } from '../auth-secret-resource.ts';
import type { ResolvedCloudOptions } from './shared.ts';

/**
 * One `AuthSecret` resource per provisioned auth-secret node — `id` is the
 * module provision id, so a secret shared by the auth service is minted once
 * and kept stable across deploys (the resource's provider preserves it).
 * `_o` is unused today (the mint needs no region/project) but kept for symmetry
 * with the other descriptors' signature.
 */
export function authSecretDescriptor(_o: ResolvedCloudOptions): NodeDescriptor {
  const lowering: Lowering = ({ id }) =>
    Effect.gen(function* () {
      const secret = yield* AuthSecret(`${id}-secret`, {});
      // No entities: a minted secret has nothing publishable. It is secret
      // material, and secret material must never reach an entity — entities
      // are built to be rendered to a terminal.
      return {
        outputs: { value: secret.value },
        entities: [],
      };
    });
  return Object.assign(lowering, { kind: 'resource' as const });
}
