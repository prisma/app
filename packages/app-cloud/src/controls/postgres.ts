/**
 * The `postgres` node kind's control: one Prisma Postgres Database (plus its
 * Connection) per system-provisioned resource, warmed before any consumer
 * deploys. Routed here by the extension's `nodes` registry (ADR-0017);
 * deploy-time only.
 */

import * as Prisma from '@prisma/alchemy';
import type { NodeControl } from '@prisma/app/config';
import type { Lowering } from '@prisma/app/deploy';
import * as Output from 'alchemy/Output';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';
import { PgWarm } from '../pg-warm-resource.ts';
import { DEFAULT_REGION, projectIdOf, type ResolvedCloudOptions, validateName } from './shared.ts';

/**
 * One Database per system-provisioned postgres resource, in the application's
 * project — `id` is the system provision id (e.g. "db"), so a resource shared
 * by several consumers is created exactly once. The url output fills each
 * consumer's Config leaf and is encoded by serialize under that service's
 * own named key — never the platform default.
 */
export function postgresControl(o: ResolvedCloudOptions): NodeControl {
  const lowering: Lowering = ({ id, application }) =>
    Effect.gen(function* () {
      validateName(id, 'resource name (from provision id)');
      const db = yield* Prisma.Database(`${id}-db`, {
        projectId: projectIdOf(application),
        name: id,
        region: o.region ?? DEFAULT_REGION,
      });
      const conn = yield* Prisma.Connection(`${id}-conn`, { databaseId: db.id, name: id });
      const url = Output.map(conn.connectionString, (value) => Redacted.value(value));
      // Warm the DB so a consumer's first connect doesn't eat PPG's cold-start
      // (FT-5226). `warm.url` is the same url, so consumers depend on the warm.
      const warm = yield* PgWarm(`${id}-warm`, { url });
      return { outputs: { url: warm.url } };
    });
  return Object.assign(lowering, { kind: 'resource' as const });
}
