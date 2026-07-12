#!/usr/bin/env -S node
import { Migration, MigrationCLI, col, primaryKey } from '@prisma-next/postgres/migration';

export default class M extends Migration {
  override describe() {
    return {
      from: null,
      to: 'sha256:6cc592598fa54163a2217aaf526589dda6e266b1fce7df4cf2108522626d5875',
    };
  }

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'Widget',
        columns: [
          col('id', 'character(36)', {
            notNull: true,
            codecRef: { codecId: 'sql/char@1', typeParams: { length: 36 } },
          }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
