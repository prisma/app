# S1 — Invert the lowering SPI (+ ADR)

## At a glance

Retire `LoweredNode` and give each of its three roles its own
consumer-declared type. Behavior-preserving except one deliberate change:
the stack effect returns `undefined`, which kills the `{ outputs: {} }`
dump alchemy prints after every deploy. All type decisions below are
settled — the implementer's freedom is limited to mechanical execution and
test-fixture naming.

## Chosen design

### Core: `packages/0-framework/1-core/core/src/deploy.ts`

**Delete** `LoweredNode`. **Add**:

```ts
/**
 * A node's inter-node wiring outputs — the values downstream nodes' declared
 * connection params resolve against (buildConfig reads them by param name).
 * Name-keyed and unknown-valued of necessity: core cannot know extension
 * types, and which producer feeds which consumer is decided by the user's
 * graph at runtime. The connection declaration is the contract.
 */
export type WiringOutputs = Readonly<Record<string, unknown>>;
```

**Change the SPI signatures** (method syntax must be kept — heterogeneous
descriptors assign to the registry through TS method bivariance; a
property-arrow form would break the assignment, do not "improve" it):

```ts
/** One node's realization. Runs inside the Alchemy stack effect. */
export type Lowering = (ctx: LowerContext) => Effect.Effect<WiringOutputs, unknown, unknown>;

export interface ApplicationDescriptor {
  provision(ctx: LowerContext): Effect.Effect<unknown, unknown, unknown>;
}

/**
 * The phased service SPI. `P` and `S` are the descriptor's OWN intra-node
 * handoff types — provision's product consumed by serialize/deploy, and
 * serialize's product consumed by deploy. Core threads them through without
 * inspection; only the descriptor that writes them reads them.
 */
export interface ServiceLowering<P = unknown, S = unknown> {
  provision(ctx: LowerContext): Effect.Effect<P, unknown, unknown>;
  serialize(ctx: LowerContext, provisioned: P, config: Config): Effect.Effect<S, unknown, unknown>;
  package(ctx: LowerContext, input: PackageInput): Effect.Effect<Artifact, unknown, unknown>;
  deploy(
    ctx: LowerContext,
    provisioned: P,
    artifact: Artifact,
    serialized: S,
  ): Effect.Effect<WiringOutputs, unknown, unknown>;
}
```

**`LowerContext` changes** (doc comments updated to match):

- `application: LoweredNode` → `application: unknown` — the owning
  extension's application hook product; `undefined` when the extension
  declares no hook. Core never reads it; the extension narrows it with its
  own type guard.
- `lowered: ReadonlyMap<NodeId, LoweredNode>` → `ReadonlyMap<NodeId, WiringOutputs>`.

**Loop changes in `lowering()`**:

- `noApplication` constant deleted; `applications` becomes
  `Map<string, unknown>`; `applications.get(node.extension)` (no `??`
  fallback — absent means `undefined`).
- `lowered` becomes `Map<NodeId, WiringOutputs>`; `lowered.set(id, …)`
  stores the descriptor's return directly.
- Final `return { outputs: {} }` → `return undefined`, and the function's
  return type becomes `Effect.Effect<undefined, LowerError, unknown>` (the
  trailing `as` assertion on the gen block updates to match; keep the
  existing assertion idiom, do not introduce new casts).
- `lower()`: `stackEffect` typed `Effect.Effect<undefined, never>`.

**`buildConfig`**: parameter `lowered: ReadonlyMap<NodeId, WiringOutputs>`;
`const producedOutputs = edge !== undefined ? (lowered.get(edge.from) ?? {}) : {};`
(the `?.outputs` hop disappears).

**`app-config.ts`**: no structural change — `NodeDescriptor`'s service arm
stays `{ kind: 'service' } & ServiceLowering` (defaults `<unknown, unknown>`).

### Extension: `packages/1-prisma-cloud/1-extensions/target/src/`

**`descriptors/shared.ts`** — replace `projectIdOf`'s `blindCast` with an
extension-owned application contract and a real narrow:

```ts
/** What prisma-cloud's application hook produces; its own descriptors are the only consumers. */
export interface CloudApplication {
  readonly projectId: string;
}

export function isCloudApplication(value: unknown): value is CloudApplication {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { projectId?: unknown }).projectId === 'string'
  );
}

/** Narrows ctx.application at the extension seam; throws naming the seam when the hook didn't run. */
export function projectIdOf(application: unknown): string {
  if (!isCloudApplication(application)) {
    throw new Error(
      'prisma-cloud: ctx.application is not this extension\'s application product — ' +
        'the prismaCloud() application hook must run before any node lowers.',
    );
  }
  return application.projectId;
}
```

(`projectIdOf` call sites pass `application` / `provisioned` as before —
see per-file notes. The `blindCast` import goes away here.)

**`control.ts`** — the application hook returns `{ projectId }` satisfying
`CloudApplication` (drop the `{ outputs: { … } }` wrapper). The
`serviceKeyProvisioner` is untouched — provisioner refs are opaque
`unknown` by design (ADR-0031), and that stays.

**`descriptors/compute.ts`** — export the descriptor's own handoff types and
type the descriptor against them:

```ts
export interface ComputeProvisioned {
  readonly serviceId: string;
  readonly projectId: string;
}
export interface ComputeSerialized {
  readonly environment: readonly Prisma.EnvironmentVariable[];
  readonly port: number;
}
```

- Factory return type: `NodeDescriptor`, object literal
  `{ kind: 'service', … } satisfies { kind: 'service' } & ServiceLowering<ComputeProvisioned, ComputeSerialized>`
  — or type the literal directly if inference cooperates; either way the
  four hooks are checked against the generic SPI.
- `provision` returns `{ serviceId: svc.id, projectId: projectIdOf(application) }`
  (no wrapper; `application.outputs['projectId']` read is replaced by
  `projectIdOf(ctx.application)`).
- `serialize`: `projectIdOf(provisioned)` → `provisioned.projectId`; returns
  `{ environment: records, port }` (no wrapper). The `port` fallback logic
  (`typeof config.service['port'] === 'number' ? … : 3000`) stays in
  serialize; `port` is a plain `number` from here on.
- `deploy`: `provisioned.serviceId` (cast deleted), `serialized.environment`
  (cast deleted), `port: serialized.port` (typeof-fallback deleted — the
  type carries it now). Returns
  `{ url: deployment.deployedUrl, projectId: provisioned.projectId }` (no
  wrapper).
- The `keyOuts` `blindCast` in serialize stays — a provisioner ref is
  `unknown` by ADR-0031 and `Output<string>` is not runtime-guardable; the
  cast's justification comment already says exactly this.

**`descriptors/s3-store.ts`**:

```ts
export interface S3StoreSerialized extends ComputeSerialized {
  readonly bucket: unknown;
  readonly accessKeyId: unknown;
  readonly secretAccessKey: unknown;
}
```

- Descriptor typed `ServiceLowering<ComputeProvisioned, S3StoreSerialized>`.
- The compose-over-base pattern stays; `base` narrows via the same
  `satisfies`/typed-literal approach used in compute (the current
  `base.kind !== 'service'` runtime check may stay for the discriminant).
- serialize spreads `…serialized` (the typed base product) plus the three
  fields; the existing D4a↔D4b missing-field error check is unchanged.
- deploy returns `{ …deployed, bucket: serialized.bucket, … }` — `deployed`
  is now `WiringOutputs` (a bare record), so the `.outputs` hops disappear.

**`descriptors/postgres.ts`, `prisma-next.ts`, `s3-credentials.ts`** — each
`Lowering` returns the bare record (drop the `{ outputs: … }` wrapper);
`projectIdOf(application)` call sites unchanged in shape (the helper's
parameter is now `unknown`).

### Tests

The compiler finds every remaining site; the known ones:

- `packages/0-framework/1-core/core/src/__tests__/lowering.test.ts` —
  `LoweredNode` import → `WiringOutputs`; `{ outputs: { url: … } }` map
  literals → bare `{ url: … }`; `run()`'s effect type parameter →
  `undefined`; fake descriptors' returns unwrap.
- `packages/1-prisma-cloud/1-extensions/target/src/__tests__/control-lowering.test.ts`
  — same treatment; application-hook assertions check the bare
  `{ projectId }` product.
- Add one new test in `lowering.test.ts`: the lowering effect resolves to
  `undefined` (pins the no-stack-output behavior).
- Add one new test near `shared.ts`'s tests (or in
  `control-lowering.test.ts`): `projectIdOf` throws its seam error on a
  non-conforming value.

### Docs

- `docs/design/10-domains/core-model.md` lines ~455–525 quote the old SPI
  verbatim — update the quoted signatures to the new ones (mechanical
  transcription of the types above).
- **ADR-0033** (next free number; re-check the index at write time) in
  `docs/design/90-decisions/`, titled
  `ADR-0033-lowering-spi-seams-are-consumer-declared.md`. Content contract:
  - Decision: each lowering-SPI seam's type is declared by its consumer —
    descriptor-owned generic phase handoffs; the connection declaration as
    the wiring contract (runtime-checked across the extension seam, and
    silent under-delivery becomes an error — S2); core-declared deployment
    results assembled by the lowering loop at full context (S3); the loop
    as the only router. No shared producer-side bag.
  - Context: the three-roles analysis of `LoweredNode` and the `NodeReport`
    failure (PR #101).
  - Consequences: the alchemy-facts appendix (stack effect runs pre-apply;
    resolved values exist only in the stack's evaluated return / action
    inputs; per-resource change status is CLI-event-only), so S2/S3 build
    on recorded facts. Cite alchemy `2.0.0-beta.59` file:line as in
    design-notes.
  - Update `docs/design/90-decisions/README.md` index.

## Coherence rationale

One reviewer, one sitting: a single mechanical seam change radiating from
one file (`deploy.ts`) through five descriptors and two test files, plus an
ADR that documents exactly that change. No behavior changes to hold in
one's head beyond the deleted stack dump.

## Scope

**In:** everything above.
**Deliberately out:** wiring enforcement (S2); primitives/results/rendering
(S3); any change to `buildConfig`'s resolution semantics; the cron shared
module and examples (they author via `module()`/`compute()`, not the SPI —
verified no `LoweredNode` references outside the files listed).

## Pre-investigated edge cases

| Case | Ruling |
| --- | --- |
| `ServiceLowering<P, S>` registry assignability | Works only through method-syntax bivariance. Keep method syntax; add a one-line comment on the interface saying so. |
| Stack effect returning `undefined` | Verified against alchemy source: `Apply.apply` short-circuits (`if (!plan.output) return undefined`) — no `setOutput` write, and the bin's `Console.log(outputs)` is skipped. Existing `alchemy_stack_output` rows become stale but harmless. |
| `keyOuts` blindCast in compute.serialize | Stays. Provisioner refs are opaque by ADR-0031; do not attempt a guard on `Output<string>`. |
| `applications` map default | Absent application hook now yields `ctx.application === undefined` (was `{ outputs: {} }`). Only prisma-cloud's own descriptors read it, and they now go through `projectIdOf`'s guard, which throws its seam error on `undefined` — correct, since those descriptors require the hook. |

## Slice-DoD

- `git grep LoweredNode` over `packages/ docs/` returns nothing.
- `pnpm lint:casts` (the cast ratchet) shows a net decrease: the two
  compute.ts `as` casts and shared.ts's `blindCast` are gone; no new casts.

## References

- Project spec: [../../spec.md](../../spec.md) · design notes:
  [../../design-notes.md](../../design-notes.md)
- `packages/0-framework/1-core/core/src/deploy.ts:54-118` (current SPI),
  `:392-536` (loop)
- `packages/1-prisma-cloud/1-extensions/target/src/control.ts:100-160`
