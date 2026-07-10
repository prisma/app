/**
 * The accept/reject matrix for postgres()'s three argument shapes. Typechecked
 * only (the package's `typecheck` script) — never executed; mirrors
 * @makerkit/core's hex-wiring.test-d.ts convention.
 */
import type { Dependable, ResourceEnd, ResourceNode } from '@makerkit/core';
import { postgres } from '../index.ts';

// ---- MUST compile: each shape yields its declared role, C inferred ----
export const identity: ResourceNode<'postgres'> = postgres({ name: 'db' });
export const dep: ResourceEnd<{ url: string }, 'postgres'> = postgres({
  client: ({ url }) => ({ url }),
});
export const dual: ResourceNode<'postgres'> & Dependable<{ url: string }, 'postgres'> = postgres({
  name: 'db',
  client: ({ url }) => ({ url }),
});

// ---- MUST be rejected ----
// @ts-expect-error an empty argument is no shape at all
postgres({});
// @ts-expect-error the identity is not a dependency — no toDependency on it
identity.toDependency();
// @ts-expect-error a client must be a factory, not a config value
postgres({ name: 'db', client: 'postgres://url' });
// @ts-expect-error name is the identity's, not a factory
postgres({ name: ({ url }: { url: string }) => ({ url }) });
