// ============================================================================
// LAYER 1 — CORE (@makerkit/core). No protocol knowledge whatsoever.
// A contract is a `kind` brand + an OPAQUE comparison type `Cmp`. The core never
// looks inside Cmp; provision only does plain assignability on it, and requires a
// matching kind (NoInfer so the brand is checked, not co-inferred away).
// ============================================================================
interface Contract<Kind extends string, Cmp> {
  readonly kind: Kind
  readonly __cmp: Cmp
  satisfies(required: Contract<Kind, unknown>): boolean // runtime mirror of the same relation
}

interface Consumer<Deps extends Record<string, Contract<any, any>>> {
  readonly deps: Deps
}

// The wiring check: each provided contract must be assignable to the consumer's
// required slot. That's the ENTIRE core-side compatibility check — one line.
declare function provision<Deps extends Record<string, Contract<any, any>>>(
  id: string,
  consumer: Consumer<Deps>,
  wiring: { [K in keyof Deps]: NoInfer<Deps[K]> },
): void

// ============================================================================
// LAYER 2 — THE RPC KIND (@makerkit/rpc). Knows what an rpc contract IS.
// The trick that makes core-side assignability correct: rpc() returns a CONCRETE
// function type, so contract()'s Cmp is a plain function map (not a mapped type
// over a generic M) — and TS applies contravariant-input / covariant-output.
// ============================================================================
interface Schema<T> { readonly _t: T }
declare function type<T>(): Schema<T>

// input/output schemas at runtime; a concrete (input) => Promise<output> at the type level.
declare function rpc<I, O>(m: { input: Schema<I>; output: Schema<O> }): (input: I) => Promise<O>

// A contract of kind "rpc" whose Cmp IS the concrete function map.
declare function contract<Fns extends Record<string, (i: any) => Promise<any>>>(fns: Fns): Contract<"rpc", Fns>

// The client the consumer's load() returns = the contract's Cmp (the function map).
type Client<C> = C extends Contract<any, infer Cmp> ? Cmp : never

// (a second kind, to prove cross-protocol wiring is rejected by the brand)
declare function wsContract<Fns extends Record<string, (i: any) => Promise<any>>>(fns: Fns): Contract<"ws", Fns>

// ============================================================================
// LAYER 3 — THE APP. Authors a contract, a consumer, and providers.
// ============================================================================
const authContract = contract({
  verify: rpc({ input: type<{ token: string }>(), output: type<{ ok: boolean }>() }),
})

// storefront requires the auth contract
declare const storefront: Consumer<{ auth: typeof authContract }>

// candidate providers (standing in for provisioned refs' exposed contracts)
const exact = contract({ verify: rpc({ input: type<{ token: string }>(), output: type<{ ok: boolean }>() }) })
const extraOut = contract({ verify: rpc({ input: type<{ token: string }>(), output: type<{ ok: boolean; user: string }>() }) })
const extraMethod = contract({
  verify: rpc({ input: type<{ token: string }>(), output: type<{ ok: boolean }>() }),
  refresh: rpc({ input: type<{ rt: string }>(), output: type<{ token: string }>() }),
})
const extraInput = contract({ verify: rpc({ input: type<{ token: string; tenant: string }>(), output: type<{ ok: boolean }>() }) })
const missing = contract({ whoami: rpc({ input: type<Record<never, never>>(), output: type<{ id: string }>() }) })
const wrongKind = wsContract({ verify: rpc({ input: type<{ token: string }>(), output: type<{ ok: boolean }>() }) })

// ---- MUST compile ----
provision("s1", storefront, { auth: exact })
provision("s2", storefront, { auth: extraOut })     // covariant output
provision("s3", storefront, { auth: extraMethod })  // width

// ---- MUST be rejected ----
// @ts-expect-error provider requires an extra input the consumer never sends (contravariant)
provision("s4", storefront, { auth: extraInput })
// @ts-expect-error provider is missing the required method
provision("s5", storefront, { auth: missing })
// @ts-expect-error different protocol kind
provision("s6", storefront, { auth: wrongKind })

// ---- and the derived client is typed both ways ----
async function useIt() {
  const auth: Client<typeof authContract> = null as any
  const r = await auth.verify({ token: "t" })
  const ok: boolean = r.ok
  // @ts-expect-error unknown method
  auth.nope()
  return ok
}
