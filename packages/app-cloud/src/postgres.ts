import type { Contract, DependencyEnd, ResourceNode } from '@prisma/app';
import { dependency, resource } from '@prisma/app';

export interface PostgresConfig {
  readonly url: string;
}

type ClientFactory<C> = (config: PostgresConfig) => C | Promise<C>;

/**
 * The contract a Postgres provides — and the contract its consumers require.
 * `satisfies` compares KIND, not identity: a pack module can be duplicated
 * across a workspace (same rationale as the Symbol.for node brand), and every
 * duplicate's contract must still satisfy. `__cmp` is the connection config a
 * postgres offers; core never inspects it.
 */
export const postgresContract: Contract<'postgres', PostgresConfig> = Object.freeze({
  kind: 'postgres',
  __cmp: { url: '' },
  satisfies: (required: Contract<'postgres', unknown>) => required.kind === 'postgres',
});

/**
 * The one Postgres factory; the argument shape picks the role. The two shapes
 * are mutually exclusive at compile time (`?: never`) and re-checked at
 * runtime for plain JS.
 *
 * `{ name }` — the resource identity a system provisions: the ONE place the
 * database exists, providing `postgresContract`. Return type declared
 * explicitly so nothing widens.
 */
export function postgres(opts: {
  name: string;
  client?: never;
}): ResourceNode<typeof postgresContract>;
/**
 * `{ client }` — a service's dependency declaration: the slot a system wires a
 * provisioned postgres's ref into, requiring `postgresContract`. The app
 * supplies the client factory; C is inferred from its return type.
 */
export function postgres<C>(opts: {
  client: ClientFactory<C>;
  name?: never;
}): DependencyEnd<C, typeof postgresContract>;
export function postgres<C>(opts: { name?: string; client?: ClientFactory<C> }): unknown {
  const { name, client } = opts;
  if (name !== undefined && client !== undefined) {
    throw new Error(
      'postgres() takes `name` (a provisionable identity) OR `client` (a dependency), not both — ' +
        'provision the identity in a system and wire its ref into the client-side dependency.',
    );
  }
  if (name !== undefined) {
    return resource({ name, pack: '@prisma/app-cloud', provides: postgresContract });
  }
  if (client !== undefined) {
    return dependency({
      type: 'postgres',
      connection: {
        params: { url: { type: 'string', secret: true } },
        // v: { url: string } — enforced by the declaration.
        hydrate: (v) => client({ url: v.url }),
      },
      required: postgresContract,
    });
  }
  throw new Error(
    'postgres() requires `name` (a provisionable identity) or `client` (a dependency).',
  );
}
