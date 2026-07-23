/**
 * Regenerates `src/pack/schema.sql` — the flat DDL equivalent of applying the
 * pack's migration graph to an empty database, in idempotent (IF NOT EXISTS)
 * form. Consumed ONLY by the testing export's local bootstrap; deploys always
 * run the real migration step.
 *
 * Rendered from the pack's shipped migration packages in order — the same
 * statement sequence PN's dbInit plans for the pack space (dbInit walks the
 * authored graph; rendering here skips the live-database round trip so the
 * output is a deterministic function of the committed ops). Each statement is
 * rewritten to its idempotent form: CREATE SCHEMA/TABLE/INDEX gain
 * IF NOT EXISTS; ADD CONSTRAINT is wrapped in a pg_constraint existence check
 * (Postgres has no IF NOT EXISTS for constraints).
 *
 * The schema-conformance test asserts the committed file equals this output.
 */
import { blindCast } from '@internal/foundation/casts';
import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import { authPack } from '../src/pack/index.ts';

function idempotent(sql: string): string {
  if (/^CREATE SCHEMA IF NOT EXISTS /i.test(sql)) return `${sql};`;
  if (/^CREATE TABLE /i.test(sql)) {
    return `${sql.replace(/^CREATE TABLE /i, 'CREATE TABLE IF NOT EXISTS ')};`;
  }
  if (/^CREATE (UNIQUE )?INDEX /i.test(sql)) {
    return `${sql.replace(/^CREATE (UNIQUE )?INDEX /i, (m) => m.replace(/INDEX $/, 'INDEX IF NOT EXISTS '))};`;
  }
  const constraint = sql.match(/^ALTER TABLE ("[^"]+"\."[^"]+")\s+ADD CONSTRAINT ("[^"]+")\s/i);
  if (constraint?.[1] !== undefined && constraint[2] !== undefined) {
    const table = constraint[1];
    const name = constraint[2].replaceAll('"', '');
    return [
      'DO $$',
      'BEGIN',
      '  IF NOT EXISTS (',
      '    SELECT 1 FROM pg_constraint',
      `    WHERE conname = '${name}' AND conrelid = '${table.replaceAll('"', '')}'::regclass`,
      '  ) THEN',
      `    EXECUTE $ddl$${sql}$ddl$;`,
      '  END IF;',
      'END $$;',
    ].join('\n');
  }
  throw new Error(`generate-schema: no idempotent form known for statement:\n${sql}`);
}

export function renderSchemaSql(): string {
  const lines: string[] = [
    '-- GENERATED FILE - DO NOT EDIT (pnpm generate:schema)',
    '-- Flat, idempotent DDL of the auth pack migration graph applied to an',
    '-- empty database. Consumed only by the testing export; deploys run the',
    '-- real migration step.',
    '',
  ];
  const migrations = authPack.contractSpace?.migrations ?? [];
  for (const pkg of migrations) {
    const ops = blindCast<
      readonly SqlMigrationPlanOperation<unknown>[],
      'the pack ships ops the SQL planner authored (execute/precheck/postcheck present in the committed JSON); the descriptor type holds them as the base display shape'
    >(pkg.ops);
    for (const op of ops) {
      for (const step of op.execute) {
        lines.push(`-- ${step.description}`);
        lines.push(idempotent(step.sql));
        lines.push('');
      }
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/** The generated TS twin of schema.sql — what the testing export imports (a bundler-safe string; no runtime file read). */
export function renderSchemaSqlModule(): string {
  return [
    '// GENERATED FILE - DO NOT EDIT (pnpm generate:schema)',
    '// The TS twin of schema.sql for the testing export — a bundler-safe',
    '// string instead of a runtime file read. The conformance test asserts',
    '// the two never drift.',
    '',
    '/** Flat, idempotent DDL of the auth pack migration graph applied to an empty database. */',
    `export const AUTH_SCHEMA_SQL = ${JSON.stringify(renderSchemaSql())};`,
    '',
  ].join('\n');
}

if (import.meta.main) {
  const sqlOut = new URL('../src/pack/schema.sql', import.meta.url);
  await Bun.write(sqlOut, renderSchemaSql());
  const tsOut = new URL('../src/pack/schema-sql.ts', import.meta.url);
  await Bun.write(tsOut, renderSchemaSqlModule());
  console.log(`wrote ${sqlOut.pathname}\nwrote ${tsOut.pathname}`);
}
