/**
 * A Contract is the declared interface of a service-to-service dependency: a
 * protocol brand (`kind`) plus an opaque comparison type (`Cmp`) the core
 * never inspects. Wiring compatibility is plain TypeScript assignability on
 * `Cmp`; `satisfies` is its runtime mirror, called at Load. Correctness comes
 * from the kind's builder shaping `Cmp` so assignability means the right
 * thing — see @makerkit/rpc's `contract()`/`rpc()`.
 */
export interface Contract<Kind extends string, Cmp> {
  readonly kind: Kind;
  readonly __cmp: Cmp;
  satisfies(required: Contract<Kind, unknown>): boolean;
}

/** A dependant's required contracts, keyed by dependency name. */
// biome-ignore lint/suspicious/noExplicitAny: generic Contract bound, matches contract-satisfaction.poc.ts.
export interface Consumer<Deps extends Record<string, Contract<any, any>>> {
  readonly deps: Deps;
}

/**
 * The wiring check a hex will use later (kept standalone until that
 * integration lands — see node.ts's `HexBuilder`): each provided contract
 * must be assignable to the consumer's required slot, with `NoInfer` on the
 * brand so `kind` is checked rather than co-inferred into a union. At runtime
 * it mirrors the same relation via each contract's own `satisfies()`.
 */
export function provision<
  // biome-ignore lint/suspicious/noExplicitAny: generic Contract bound, matches contract-satisfaction.poc.ts.
  Deps extends Record<string, Contract<any, any>>,
>(id: string, consumer: Consumer<Deps>, wiring: { [K in keyof Deps]: NoInfer<Deps[K]> }): void {
  for (const [key, required] of Object.entries(consumer.deps)) {
    const provided = (wiring as Record<string, Contract<string, unknown>>)[key];
    if (provided === undefined || !provided.satisfies(required)) {
      throw new Error(`provision("${id}"): "${key}" does not satisfy its required contract.`);
    }
  }
}
