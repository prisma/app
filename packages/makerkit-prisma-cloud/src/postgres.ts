import type { Dependable, ResourceEnd, ResourceNode } from '@makerkit/core';
import { resource, resourceEnd } from '@makerkit/core';

export interface PostgresConfig {
  readonly url: string;
}

type ClientFactory<C> = (config: PostgresConfig) => C | Promise<C>;

/**
 * The one Postgres factory; the argument shape picks the role. The shapes are
 * mutually exclusive at compile time (`?: never`) and re-checked at runtime
 * for plain JS.
 *
 * `{ name }` — the resource identity a hex provisions: the ONE place the
 * database exists, never created because a service mentioned it. Return type
 * declared explicitly so the 'postgres' literal never widens (an inline call
 * nested in provision() otherwise infers ResourceNode<string>).
 */
export function postgres(opts: { name: string; client?: never }): ResourceNode<'postgres'>;
/**
 * `{ client }` — a service's dependency declaration: the ResourceEnd slot a
 * hex wires a provisioned postgres into. The app supplies the client factory;
 * C is inferred from its return type.
 */
export function postgres<C>(opts: {
  client: ClientFactory<C>;
  name?: never;
}): ResourceEnd<C, 'postgres'>;
/**
 * `{ name, client }` — the dual form: a provisionable identity that can also
 * sit directly in `deps`, describing the dependency on itself via
 * `toDependency()` (the built end carries `name` as its diagnostic name).
 * One value, one client — consumers needing different drivers use the split
 * shapes instead.
 */
export function postgres<C>(opts: {
  name: string;
  client: ClientFactory<C>;
}): ResourceNode<'postgres'> & Dependable<C, 'postgres'>;
export function postgres<C>(opts: { name?: string; client?: ClientFactory<C> }): unknown {
  const { name, client } = opts;
  if (name !== undefined && client !== undefined) {
    // resource() freezes its result, so the dual is the pack's own composed
    // value: the identity's fields plus the conversion, frozen again. The end
    // is built lazily inside toDependency() — pure either way; the client
    // factory itself never runs here.
    const identity = resource({ name, pack: '@makerkit/prisma-cloud', type: 'postgres' });
    return Object.freeze({ ...identity, toDependency: () => dependency(client, name) });
  }
  if (name !== undefined) {
    return resource({ name, pack: '@makerkit/prisma-cloud', type: 'postgres' });
  }
  if (client !== undefined) {
    return dependency(client);
  }
  throw new Error(
    'postgres() requires `name` (a provisionable identity), `client` (a dependency), or both.',
  );
}

function dependency<C>(client: ClientFactory<C>, name?: string): ResourceEnd<C, 'postgres'> {
  return resourceEnd({
    ...(name !== undefined ? { name } : {}),
    type: 'postgres',
    connection: {
      params: { url: { type: 'string', secret: true } },
      // v: { url: string } — enforced by the declaration.
      hydrate: (v) => client({ url: v.url }),
    },
  });
}
