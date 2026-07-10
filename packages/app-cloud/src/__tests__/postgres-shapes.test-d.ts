/**
 * The accept/reject matrix for postgres()'s two argument shapes. With the dual
 * form gone, `{ name }` is the provisionable identity and `{ client }` is the
 * dependency; `{ name, client }` and `{}` are compile errors.
 *
 * Type-only (vitest `--typecheck`, never executed). Positive cases assert the
 * returned role via `expectTypeOf`; the rejected shapes keep a
 * `// @ts-expect-error` on the offending line.
 */
import type { DependencyEnd, ResourceNode } from '@prisma/app';
import { expectTypeOf, test } from 'vitest';
import { postgres, type postgresContract } from '../index.ts';

const identity = postgres({ name: 'db' });
const dep = postgres({ client: ({ url }) => ({ url }) });

test('{ name } yields the resource identity providing postgresContract', () => {
  expectTypeOf(identity).toEqualTypeOf<ResourceNode<typeof postgresContract>>();
});

test('{ client } yields the dependency slot requiring postgresContract, C inferred', () => {
  expectTypeOf(dep).toEqualTypeOf<DependencyEnd<{ url: string }, typeof postgresContract>>();
});

test('bad argument shapes do not compile', () => {
  // @ts-expect-error an empty argument is no shape at all
  postgres({});
  // @ts-expect-error name and client are mutually exclusive — the identity and the dependency are separate
  postgres({ name: 'db', client: ({ url }: { url: string }) => ({ url }) });
  // @ts-expect-error a client must be a factory, not a config value
  postgres({ client: 'postgres://url' });
  // @ts-expect-error name is the identity's, not a factory
  postgres({ name: ({ url }: { url: string }) => ({ url }) });
});
