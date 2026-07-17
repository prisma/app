# ADR-0033: Every lowering-SPI seam's type is declared by its consumer

## Decision

The lowering SPI has several seams — points where one party's value becomes
another party's input. **Each seam's type is declared by the party that reads
it, not by the party that produces it.** No single shared record serves more
than one seam.

Concretely, replacing `LoweredNode` (`{ outputs: Record<string, unknown> }`):

```ts
// SEAM 1 — a descriptor's own phase handoffs. Declared by the descriptor that
// writes AND reads them; core threads P and S through without inspecting either.
export interface ServiceLowering<P = unknown, S = unknown> {
  provision(ctx: LowerContext): Effect.Effect<P, unknown, unknown>;
  serialize(ctx: LowerContext, provisioned: P, config: Config): Effect.Effect<S, unknown, unknown>;
  package(ctx: LowerContext, input: PackageInput): Effect.Effect<Artifact, unknown, unknown>;
  deploy(ctx: LowerContext, provisioned: P, artifact: Artifact, serialized: S):
    Effect.Effect<WiringOutputs, unknown, unknown>;
}

// SEAM 2 — the application seam. Core declares nothing; the owning extension
// declares its own product and narrows with its own guard.
readonly application: unknown;

// SEAM 3 — inter-node wiring. Name-keyed, unknown-valued: the consumer's
// connection declaration is the contract, resolved by param name at runtime.
export type WiringOutputs = Readonly<Record<string, unknown>>;
```

The **lowering loop is the only router**. It alone knows that `deploy`'s return
feeds `buildConfig` for dependent nodes. Descriptors do not know `buildConfig`
exists. A future consumer of a descriptor's output must declare its own
interface and appear as a visible routing edit in the loop.

Two seams are decided here and implemented in later slices: the wiring
contract becomes **enforced** — a producer that fails to supply a param the
consumer's connection declares fails the deploy naming the edge (S2) — and
**deployment results** become core-declared types the loop assembles at full
context (S3). Neither is implemented by this ADR.

## Reasoning

### What went wrong

`LoweredNode` was one type serving three unrelated contracts:

1. **Intra-descriptor phase handoffs** — `provision` → `serialize`/`deploy`.
   Same party writes and reads; core never looks inside. Forcing them through
   the shared record made descriptors cast to recover types they had produced
   themselves two phases earlier.
2. **Inter-node wiring** — `deploy`'s return, stored in the `lowered` map, read
   by `buildConfig` by param name. The only role core genuinely consumes.
3. **Reporting** — the reverted `NodeReport` (PR #101), possible only because a
   shared untyped record accepts a new field without any consumer's signature
   changing.

A shared bag is a *producer-side* type: it describes what someone hands over,
not what anyone needs. That is what let one type serve three consumers — and
what let reporting data be added to the wiring contract without any reviewer
seeing an interface change.

### The evidence: a type lie the bag hid indefinitely

Migrating the first descriptor off `LoweredNode` immediately surfaced a bug
that had been live and invisible.

Compute's `provision` yields an Alchemy `ComputeService` and stores `svc.id`.
`ComputeServiceAttributes` declares `id: string`, so `serviceId` looked like a
`string` — and `deploy` read it back as one:

```ts
computeServiceId: provisioned.outputs['serviceId'] as string,   // the lie
```

`svc.id` is **not** a `string`. Alchemy's `Resource` type maps every attribute
through `Output` (`Resource.d.ts:95-100`), so `svc.id` is an `Output<string>` —
an unresolved, lazy reference (see the appendix). The cast laundered that
reference into a `string` at the read site, and it compiled for one reason:
the consuming prop is `Input<string>`, which accepts **both** a `string` and an
`Output<string>`. Nothing in the pipeline ever objected.

Typing the handoff honestly deletes the cast rather than relocating it:

```ts
export interface ComputeProvisioned {
  readonly serviceId: Output.Output<string>;  // what it actually is
  readonly projectId: string;                 // CLI env, genuinely a string
}
// deploy, now:
computeServiceId: provisioned.serviceId,      // no cast; Input<string> accepts it
```

### The thesis: deliberate and audited, not absence of claims

The tempting conclusion — "a shared bag lets you lie; a typed handoff doesn't"
— is refuted by our own code. `compute.serialize` keeps a `blindCast` that
claims `Output<string>` for a provisioner ref, reached through a *different*
`unknown`-typed seam ([ADR-0031](ADR-0031-provisioned-param-values-are-a-need-resolved-through-a-target-registry.md)
makes those refs deliberately opaque). It is the same kind of unchecked claim
that `as string` was. **We are keeping it.**

The distinction that matters is not whether an unchecked claim exists. It is
whether the claim is **named, justified, and singular**:

- The provisioner-ref cast is **one site**, carrying a written justification of
  why no guard is possible. A reviewer can evaluate that argument. A grep finds
  every instance. It is a decision on the record.
- The bag made the same kind of claim **anonymously, at every read site, with
  nothing recording that a claim was being made at all.** `outputs['serviceId']`
  reads as ordinary field access. Nothing marks it as the moment someone decided
  an `unknown` was a `string`. No reviewer was ever asked.

That is why `serviceId` survived code review and `keyOuts` is fine. The goal is
not zero unchecked claims — it is that every one is deliberate and auditable.

### Three seams, three mechanisms

The seams differ in what they claim and what defends the claim:

| Seam | Claims | Defended by |
| --- | --- | --- |
| **Phase handoffs** (`P`, `S`) | Precise types | The **compiler** — same party writes and reads, so it can check both ends |
| **Application seam** (`ctx.application`) | Precise: `CloudApplication.projectId: string` | A **runtime guard** (`isCloudApplication`) — the claim crosses core's `unknown` into an extension, where the compiler cannot reach |
| **Wiring** (`WiringOutputs`) | **Nothing** — values are `unknown` | Nothing needed. `unknown` cannot lie |

The third row is the load-bearing observation. `warm.url` (postgres) and
`creds.accessKeyId` (s3-credentials) are *also* unresolved `Output<string>`s —
exactly like `serviceId`. They were never mis-typed, and could not have been:
they flow into `WiringOutputs`, which claims nothing about them. Core cannot
know extension types, and which producer feeds which consumer is decided by the
user's graph at runtime, so the wiring seam declares its ignorance honestly and
resolves by name against the consumer's declared params.

**The bug could only ever have lived where a precise claim was made with no
mechanism defending it.** The application seam makes a precise claim too — it
is defended by a guard rather than the compiler, which is why there are three
mechanisms and not two.

## Consequences

### Alchemy execution facts this rests on

Verified against `alchemy@2.0.0-beta.59`; S2 and S3 build on these rather than
re-deriving them.

- **The whole stack effect runs before anything is applied.**
  `deploy = evalStack(stackEffect) → Plan.make → Apply.apply`
  (`src/Deploy.ts:25-30`). Our entire `lowering()` generator completes before
  the first platform call.
- **Yielding a resource returns a lazy proxy**, whose property reads produce
  `Output.PropExpr` references (`src/Resource.ts:275-283`).
  `deployment.deployedUrl` inside a descriptor is symbolic, not a URL.
- **Therefore phase-handoff types legitimately carry unresolved `Output<T>`
  references.** A handoff type promising resolved values is lying — this is the
  same lazy-Output truth as the execution model, surfacing in the SPI's types.
  `ComputeProvisioned.serviceId: Output<string>` is the correct type, not a
  compromise.
- **Resolved values reach program code in exactly one place**: apply evaluates
  whatever the stack effect returned and returns that resolved structure
  (`src/Apply.ts:198`). It also unconditionally persists it via `state.setOutput`
  (`src/Apply.ts:203`) — alchemy's cross-stack-reference mechanism — so whatever
  crosses that boundary must be plain data.
- **The stack effect now returns `undefined`.** `Apply.apply` short-circuits on
  a falsy plan output (`src/Apply.ts:191-193`): no `setOutput` write, and the
  CLI skips its `Console.log`. This removes the `{ outputs: {} }` dump printed
  after every deploy. Existing `alchemy_stack_output` rows go stale but harmless.
- **Per-resource change status (created/updated/noop/skipped) is not returned to
  the program.** It lives in apply's tracker and is emitted as status-change
  events to alchemy's CLI session service (`src/Apply.ts:184-185`, `:415-421`).
  Capturing it requires wrapping that service or an upstream change.

### The registry's type safety rests on the loop, not the compiler

Descriptors with different `P`/`S` assign into one
`Record<string, NodeDescriptor>` only through TypeScript's **method
bivariance** — which is why `ServiceLowering` must use method syntax; a
property-arrow form is checked contravariantly and the assignment fails.

This is **unsound by construction**, and deliberately accepted. Core calls
`descriptor.serialize(ctx, provisionedNode, config)` with `provisionedNode`
typed `unknown`, so the compiler would not object if the loop ever threaded the
wrong node's provisioned value into a descriptor. The loop is correct today;
nothing but the loop makes it correct.

This is the price of a heterogeneous registry core cannot type. It is recorded
here so that anyone editing the lowering loop — S2 and S3 both do — knows what
they are holding.

### `ComputeSerialized` crosses a module boundary — and that is a tripwire

One producer-side shape is imported across modules: `s3-store`'s
`S3StoreSerialized extends ComputeSerialized`. This is legitimate because
`s3-store` **composes compute's own descriptor** — it delegates to compute's
hooks and extends their product. Same party, not an unrelated consumer.

**The tripwire:** a third descriptor importing `ComputeSerialized` *without*
composing compute is the shared bag reforming. The answer then is its own
handoff type, not a widened shared one.

For the same reason, `computeDescriptor` returns its precise descriptor type
rather than the erased `NodeDescriptor`. The registry erases `P`/`S` on
assignment anyway, but `s3-store` needs them visible; annotating
`NodeDescriptor` would force `s3-store` to cast them straight back —
re-creating the exact seam this ADR exists to remove.

### General

- Each of `LoweredNode`'s three roles now has its own consumer-declared type;
  no descriptor casts to recover a value it produced itself.
- A new consumer of a descriptor's output requires a declared interface and a
  visible routing edit in the loop. The dumping-ground regression that produced
  `NodeReport` becomes structurally impossible.
- **The descriptor names what is publishable.** Core never infers meaning from
  output keys: `url` means a public endpoint because the descriptor said so.
  No core-level rule is safe — `url` on compute is an endpoint, on postgres it
  would be a connection string.
- An extension whose application hook does not run yields `ctx.application ===
  undefined` (previously `{ outputs: {} }`). Prisma-cloud's descriptors go
  through `projectIdOf`'s guard, which fails naming the seam — correct, since
  those descriptors require the hook.

## Alternatives considered

- **`NodeReport` on `LoweredNode`** (PR #101) — rejected: reporting data on the
  wiring contract, untyped, and meaningless on two of the three phases. This
  ADR supersedes that approach.
- **A separate `describe()` SPI hook** — rejected: the resource handles live
  inside `deploy()`'s effect; `describe()` would need them handed back out,
  which is returning them with extra plumbing.
- **Full generic threading of the application type** through
  `ExtensionDescriptor`/`NodeDescriptor` — rejected: the registry is
  heterogeneous, and the assignment would lean on method bivariance in
  contravariant positions across packages. `ServiceLowering<P, S>` is fine
  because producer and consumer are the same descriptor; the application type
  has no such guarantee. Hence `unknown` plus an extension-owned guard.
- **Keeping `serviceId: string` and casting** — rejected: it would have forced
  the deleted cast's reintroduction. The accurate type removes it.

## References

- `packages/0-framework/1-core/core/src/deploy.ts` — the SPI and the lowering loop.
- `packages/1-prisma-cloud/1-extensions/target/src/descriptors/` — the migrated descriptors.
- [ADR-0005](ADR-0005-users-build-the-framework-assembles.md) — users build, the framework assembles.
- [ADR-0031](ADR-0031-provisioned-param-values-are-a-need-resolved-through-a-target-registry.md) — provisioner refs are opaque by design.
- alchemy `2.0.0-beta.59`: `src/Deploy.ts`, `src/Resource.ts`, `src/Apply.ts`; `lib/Resource.d.ts`.
- Composer PR #101 — the superseded `NodeReport` attempt.
</content>
</invoke>
