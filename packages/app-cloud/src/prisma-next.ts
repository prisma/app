/**
 * `pnPostgres()` is the `prisma-next` kind's single entry, overloaded by what
 * it's given — the typed sibling of bare `postgres()` (untouched in
 * `postgres.ts`). A resource end takes `{ name, contract }`, where `contract`
 * is the consumed emitted artifact the resource provides; a dependency end
 * takes that same wrapped contract value and hydrates to a typed Prisma Next
 * client, `Client<Contract>`, over the injected `{ url }` connection. This
 * amends ADR-0015 for this one dep kind (see ADR-0022): Prisma Next is
 * framework-blessed like rpc, so the binding is the typed client itself, not
 * a config the app builds its own client from.
 *
 * `Cmp` (`PnCmp`) carries the deserialized contract data (`contractJson`,
 * read by hydrate) plus a type-only `_contract` anchor pinning the emitted
 * contract's branded `storageHash` literal — the lever that makes plain
 * TypeScript assignability between two wrapped contracts exact-version
 * equality. `satisfies()` mirrors it at Load with a real `storageHash`
 * comparison (not `rpc`'s identity check — this kind needs a genuine
 * version-equality test, since two distinct in-memory contract values can
 * carry the same hash).
 *
 * There is NO runtime schema verification. Schema correctness is a
 * build/deploy-time job: the deploy migrates the database to the contract's
 * hash and guarantees it stays there, so hydrate just builds the client (no
 * `verifyMarker`). A running service can't be crashed by a marker check
 * because there is no marker check (ADR-0022).
 */

import type { Contract, DependencyEnd, ResourceNode } from '@prisma/app';
import { dependency, resource, string } from '@prisma/app';
import pnPostgresRuntime, { type PostgresClient } from '@prisma-next/postgres/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';

/**
 * Any Prisma Next contract this primitive can carry — the bound both
 * authoring modes (TS no-emit `defineContract()`, or PSL/emitted
 * `contract.d.ts`) satisfy.
 */
export type AnyPnContract = import('@prisma-next/contract/types').Contract<SqlStorage>;

/**
 * The comparison payload behind a `prisma-next` Contract. `contractJson` is
 * the plain, deserialized contract data hydrate hands the Prisma Next
 * runtime — the same shape as an emitted `contract.json`, or a TS-authored
 * contract's own value (both satisfy `postgres()`'s `contractJson: unknown`
 * parameter). `_contract` never exists at runtime — it is the type-only
 * anchor that carries the emitted contract's type, so plain assignability
 * between two `PnCmp`s requires `_contract`'s type to match, which for a
 * branded `storageHash` literal means the hashes must be identical.
 */
export interface PnCmp<C extends AnyPnContract = AnyPnContract> {
  readonly contractJson: unknown;
  readonly _contract?: C;
}

/** The `prisma-next` kind: a Contract whose `Cmp` is `PnCmp`. */
export type PnPostgresContract<C extends AnyPnContract = AnyPnContract> = Contract<
  'prisma-next',
  PnCmp<C>
>;

/** Recovers the emitted contract type `C` a `prisma-next` Contract carries. */
export type PnContractOf<Ct> = Ct extends PnPostgresContract<infer C> ? C : never;

/** The typed client a consumer's `pnPostgres(contract)` dependency hydrates to. */
export type Client<Ct> = PostgresClient<PnContractOf<Ct>>;

/**
 * The `prisma-next` resource node: a core `ResourceNode` augmented with
 * `config`, the `prisma-next.config.ts` path. Two doors (ADR-0022): the
 * contract is consumed through `provides` (types + wires the resource, and
 * gives the deploy its target `storageHash`); `config` is a deploy-only path
 * the migration lowering loads to resolve the migrations directory — the app
 * build never imports it. Not a core `ResourceNode` field: the path is this
 * extension's deploy concern, so it rides on app-cloud's own node shape.
 */
export type PnPostgresResourceNode<C extends PnPostgresContract = PnPostgresContract> =
  ResourceNode<C> & { readonly config: string };

/**
 * True if `node` is a `pnPostgres` resource node carrying its config path —
 * the deploy lowering's read predicate for `ctx.node` (typed `ServiceNode |
 * ResourceNode`), so it reads `config` without a bare cast. Checks the
 * resource kind, the `prisma-next` routing type, and that `config` is a
 * string.
 */
export function isPnPostgresResourceNode(node: unknown): node is PnPostgresResourceNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    'kind' in node &&
    node.kind === 'resource' &&
    'type' in node &&
    node.type === 'prisma-next' &&
    'config' in node &&
    typeof node.config === 'string'
  );
}

/**
 * Wraps a resolved Prisma Next contract value into the framework's
 * `prisma-next` Contract kind. Both the resource end's `contract` and every
 * dependency end reference the SAME wrapped value, the same way
 * `@prisma/app-rpc`'s `contract()` output feeds both a service's `expose`
 * and its consumers' `rpc(contract)` deps.
 *
 * Two overloads, mirroring `@prisma-next/postgres/runtime`'s own
 * `PostgresOptionsWithContract` / `PostgresOptionsWithContractJson` split:
 * - TS-authored, no-emit (`defineContract()`'s own return value): `C` is
 *   inferred from the argument, which already carries the branded types.
 * - Emitted (a deserialized `contract.json`, e.g. via a JSON module import):
 *   the argument's inferred type is plain JSON data, not the branded
 *   `contract.d.ts` type, so `C` cannot be inferred from it — pass it
 *   explicitly: `pnContract<Contract>(contractJson)`.
 */
export function pnContract<const C extends AnyPnContract>(contract: C): PnPostgresContract<C>;
export function pnContract<C extends AnyPnContract>(contractJson: unknown): PnPostgresContract<C>;
export function pnContract(contract: unknown): unknown {
  const value: PnPostgresContract = {
    kind: 'prisma-next',
    __cmp: { contractJson: contract },
    satisfies: (required) => {
      const requiredHash = storageHashOf(required);
      return requiredHash !== undefined && requiredHash === storageHashOf(value);
    },
  };
  return Object.freeze(value);
}

/**
 * `{ name, contract, config }` — the resource identity a system provisions:
 * the ONE place the database exists. Two doors (ADR-0022): `contract` is
 * consumed as the provided port (`provides`), typing and wiring the resource
 * and carrying the target `storageHash`; `config` is the `prisma-next.config.ts`
 * PATH — deploy-only metadata the migration lowering loads to locate the
 * migrations directory. The app build never imports the config; only the
 * deploy lowering reads it, via `isPnPostgresResourceNode`.
 */
export function pnPostgres<C extends PnPostgresContract>(opts: {
  name: string;
  contract: C;
  config: string;
}): PnPostgresResourceNode<C>;
/**
 * `pnPostgres(contract)` — a service's dependency on a Prisma Next-typed
 * Postgres. Its binding is the typed Prisma Next client, constructed by the
 * framework in hydrate from the contract plus the injected connection URL.
 */
export function pnPostgres<C extends PnPostgresContract>(contract: C): DependencyEnd<Client<C>, C>;
export function pnPostgres(
  arg: { name: string; contract: PnPostgresContract; config: string } | PnPostgresContract,
): unknown {
  if (!isPnPostgresContract(arg)) {
    // Augment the frozen core node with `config`. The `[NODE]`
    // `Symbol.for('prisma:node')` brand is an enumerable own symbol prop, so
    // object spread copies it — the augmented node stays a recognized node
    // (provisions and Loads exactly like a bare resource).
    return Object.freeze({
      ...resource({
        name: arg.name,
        extension: '@prisma/app-cloud',
        provides: arg.contract,
      }),
      config: arg.config,
    });
  }
  const contract = arg;
  return dependency({
    type: 'prisma-next',
    connection: {
      params: { url: string({ secret: true }) },
      hydrate: ({ url }) => buildClient(contract, url),
    },
    required: contract,
  });
}

function isPnPostgresContract(value: unknown): value is PnPostgresContract {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'prisma-next' &&
    '__cmp' in value &&
    'satisfies' in value
  );
}

function buildClient<C extends PnPostgresContract>(contract: C, url: string): Client<C> {
  return pnPostgresRuntime<PnContractOf<C>>({
    contractJson: contract.__cmp.contractJson,
    url,
  });
}

/** Reads `__cmp.contractJson.storage.storageHash` off a `prisma-next` Contract, defensively — `__cmp` is opaque to core, so nothing guarantees its shape without a runtime check. */
function storageHashOf(contract: Contract<'prisma-next', unknown> | undefined): string | undefined {
  if (contract === undefined) return undefined;
  const cmp = contract.__cmp;
  if (typeof cmp !== 'object' || cmp === null || !('contractJson' in cmp)) return undefined;
  const contractJson = cmp.contractJson;
  if (typeof contractJson !== 'object' || contractJson === null || !('storage' in contractJson)) {
    return undefined;
  }
  const storage = contractJson.storage;
  if (typeof storage !== 'object' || storage === null || !('storageHash' in storage))
    return undefined;
  const hash = storage.storageHash;
  return typeof hash === 'string' ? hash : undefined;
}
