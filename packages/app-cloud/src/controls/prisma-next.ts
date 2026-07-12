/**
 * The `prisma-next` node kind's control: a Prisma Postgres DB (provisioned
 * exactly like `postgres`) PLUS a migration step that brings the live DB to
 * the contract's storageHash (ADR-0022). Routed here by the extension's
 * `nodes` registry; deploy-time only.
 */

import * as Prisma from '@prisma/alchemy';
import type { NodeControl } from '@prisma/app/config';
import type { Lowering } from '@prisma/app/deploy';
import * as Output from 'alchemy/Output';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';
import { PgWarm } from '../pg-warm-resource.ts';
import { resolveMigrationsDir } from '../pn-config.ts';
import { PnMigration } from '../pn-migration-resource.ts';
import { isPnPostgresResourceNode } from '../prisma-next.ts';
import { targetStorageHash } from '../prisma-next-migrate.ts';
import { DEFAULT_REGION, projectIdOf, type ResolvedCloudOptions, validateName } from './shared.ts';

/**
 * The migration is a tracked `PnMigration` Alchemy resource keyed on the
 * target hash, so it participates in deploy state: unchanged redeploy is a
 * no-op, a contract change re-migrates, a failed apply leaves the DB
 * unchanged. `node` carries the config path (`isPnPostgresResourceNode`) and
 * the contract (`provides`); the config is read at deploy-time only.
 */
export function prismaNextControl(o: ResolvedCloudOptions): NodeControl {
  const lowering: Lowering = ({ id, node, application }) =>
    Effect.gen(function* () {
      validateName(id, 'resource name (from provision id)');
      const db = yield* Prisma.Database(`${id}-db`, {
        projectId: projectIdOf(application),
        name: id,
        region: o.region ?? DEFAULT_REGION,
      });
      const conn = yield* Prisma.Connection(`${id}-conn`, { databaseId: db.id, name: id });
      const url = Output.map(conn.connectionString, (value) => Redacted.value(value));

      if (!isPnPostgresResourceNode(node)) {
        // The registry routes 'prisma-next'-typed resource nodes here, so this
        // is unreachable — but narrow explicitly rather than cast to read config.
        throw new Error(`prisma-next lowering received a non-prisma-next node (${id}).`);
      }
      const contractJson = node.provides.__cmp.contractJson;
      const targetHash = targetStorageHash(contractJson);
      const migrationsDir = yield* Effect.promise(() => resolveMigrationsDir(node.config));

      // Warm the DB first (FT-5226), then migrate against the now-warm url —
      // `warm.url` threads the ordering (PgWarm → PnMigration). The migration
      // keeps its own withConnectionRetry as a backstop.
      const warm = yield* PgWarm(`${id}-warm`, { url });

      // Register the migration as a tracked resource — its provider's reconcile
      // receives the RESOLVED (warm) url at apply-time and runs the migration.
      yield* PnMigration(`${id}-migrate`, {
        url: warm.url,
        contractJson,
        migrationsDir,
        targetHash,
      });

      return { outputs: { url: warm.url } };
    });
  return Object.assign(lowering, { kind: 'resource' as const });
}
