# S3 — DeploymentResult and rendered deploys

## At a glance

A node's final lowering phase reports the platform primitives it became,
distinctly from its wiring outputs. The lowering loop assembles them; an
alchemy **Action** — declared last in the stack effect, forced to run every
deploy by a nonce — receives the *resolved* primitives during apply, joins
them to the graph it holds by closure, and invokes a CLI-supplied renderer.
The user sees their own topology with ids and public URLs; alchemy's raw
stack-output dump stays dead (the stack still returns `undefined`).
Supersedes PR #101.

**Mechanism rationale (recorded so it isn't re-litigated):** the stack
effect runs before apply, so program code can't see resolved values after
the fact; the bin has no post-apply hook; parent-side state readback needs
a faked `Stack` service, re-takes the deploy lock, and must replicate
alchemy's `dev_${USER}` stage derivation. Actions are alchemy's designed
"run during apply with resolved inputs" primitive — verified in
`src/Action.ts` / `src/Plan.ts:1040-1100` / `src/Apply.ts:1103-1232`
(2.0.0-beta.59). Actions noop when their input hash is unchanged, hence
the nonce.

## Chosen design

### Core types — `packages/0-framework/1-core/core/src/deploy.ts`

```ts
/**
 * One platform thing a node became. The descriptor names it; core never
 * infers. `url` is present ONLY when the descriptor declares the address
 * publicly reachable — a connection string is never a `url`.
 */
export interface DeployedPrimitive {
  readonly kind: string;
  readonly id: string;
  readonly url?: string;
  readonly details?: Readonly<Record<string, string>>;
}

/** What a node's final lowering phase produces: wiring for dependents, primitives for reporting. */
export interface LoweredResult {
  readonly wiring: WiringOutputs;
  readonly primitives?: readonly DeployedPrimitive[];
}

/** What one graph node became — the deploy subsystem's own result type. In-process only. */
export interface DeploymentResult {
  readonly address: string;
  readonly node: ServiceNode | ResourceNode;
  readonly primitives: readonly DeployedPrimitive[];
}
```

`LowerOptions` gains:

```ts
/** Invoked once per deploy, during apply, with every node's resolved results in topo order. Presentation belongs to the caller (the CLI wires its renderer here); core never formats. */
readonly report?: (results: readonly DeploymentResult[]) => void;
```

### SPI change

- `Lowering` (resources): returns `LoweredResult` (was `WiringOutputs`).
- `ServiceLowering.deploy`: returns `LoweredResult`. `provision`/`serialize`/
  `package` unchanged.

### Loop change — `lowering()`

- Per node: `const result = yield* …; lowered.set(id, result.wiring);` and
  collect `entries.push({ address: id, primitives: result.primitives ?? [] })`
  in topo order.
- After the loop, **only when `opts.report !== undefined`**, declare the
  action (inline form, `Action('composer-deployment-report', runner)`,
  imported from `alchemy`):
  - **Input** (plain data + alchemy Inputs ONLY — never graph nodes: the
    plan hashes the resolved input, and nodes carry functions/schemas):
    `{ nonce: Date.now(), entries }` where `entries` is the address+
    primitives array. The nonce defeats the input-hash noop so the report
    runs on unchanged redeploys.
  - **Runner**: receives the resolved input; closes over `graph` and
    `opts`; joins via the pure helper below; calls `opts.report(results)`;
    returns `undefined`.
  - `yield*` the action call so it lands in the stack's plan; its input
    referencing every primitive gives it upstream edges on every reporting
    resource, so apply runs it after them.
- The stack effect still returns `undefined` (no `setOutput`, no bin dump).
- Extract the join as an exported pure function so it is unit-testable
  without alchemy:

```ts
/** Joins resolved report entries back to their graph nodes. Skips addresses the graph no longer holds (defensive: entries are data, the graph is truth). */
export function joinDeployment(
  graph: Graph,
  entries: readonly { address: string; primitives: readonly DeployedPrimitive[] }[],
): readonly DeploymentResult[]
```

- The gen-block's closing type assertion updates for the yield of the
  action effect (whose requirements include alchemy's `Stack` context) —
  keep the existing single-assertion idiom.
- Tests that run `lowering()` without `opts.report` never construct the
  action and stay sync-runnable — this conditionality is REQUIRED, not an
  optimization.

### Descriptor primitives — pinned per descriptor

| Descriptor | `primitives` |
| --- | --- |
| compute `deploy` | `[{ kind: 'compute-service', id: provisioned.serviceId, url: deployment.deployedUrl }]` |
| s3-store `deploy` | base compute's primitives, unchanged (delegation passes them through with the wiring spread) |
| postgres | `[{ kind: 'postgres-database', id: db.id }]` — **no `url`** (connection string is not public) |
| prisma-next | `[{ kind: 'postgres-database', id: db.id }]` |
| s3-credentials | `[]` — a minted keypair has nothing publishable; secret material must never appear in a primitive |

Wiring returns wrap accordingly: e.g. compute deploy returns
`{ wiring: { url: deployment.deployedUrl, projectId: provisioned.projectId }, primitives: […] }`.

### Renderer — `packages/0-framework/3-tooling/cli/src/render-deployment.ts`

```ts
/** Renders a deploy's results as the app's own topology. Pure — returns the string; the caller prints. */
export function renderDeployment(appName: string, results: readonly DeploymentResult[]): string
```

Pinned format — tree by dot-address segments, box-drawing guides, one line
per primitive `kind id`, URL indented on its own line when present, nodes
without primitives listed with `(no primitives reported)`:

```
storefront-auth
├─ auth
│  └─ api   compute-service cps_abc123
│           https://xyz.ewr.prisma.build
├─ db       postgres-database pdb_def456
└─ web      compute-service cps_ghi789
            https://uvw.ewr.prisma.build
```

The default report callback (same file):

```ts
/** The report hook the generated stack file wires into LowerOptions. */
export function deploymentReport(appName: string): (results: readonly DeploymentResult[]) => void
```

— prints a leading blank line then `renderDeployment` output via
`console.log`.

### Wiring it through — generated stack + public package

- `packages/9-public/composer/package.json` gains an export path
  `"./report"` mapping to a new build entry that re-exports
  `deploymentReport` (and `renderDeployment`) from `@internal/cli`'s
  module. Follow the existing per-entry build convention in that package
  (mirror how `./deploy` is produced).
- `generate-stack.ts`'s template adds
  `import { deploymentReport } from '@prisma/composer/report';` and, inside
  the options literal, `report: deploymentReport(<quoted name>),` (the same
  `name` already rendered into options). Snapshot tests in
  `generate-stack.test.ts` update.
- `run-alchemy.ts` and `main.ts` are untouched — rendering happens in the
  child, inside apply.

### PR #101

Close with a comment linking this slice's PR and one sentence: superseded
by the consumer-declared-seams design (ADR-0033); `NodeReport` is
withdrawn.

## Coherence rationale

One reviewer can hold it: one SPI return-type change, five mechanical
descriptor edits, one new pure renderer, one action declaration, one
template line. The alchemy-facing novelty (the Action) is isolated to ~15
lines in `lowering()` with its mechanism documented in the ADR appendix.

## Scope

**In:** everything above.
**Deliberately out:** per-node `ok`/diagnostics (fail-fast decision
pending — the `DeploymentResult` shape deliberately leaves room, adding a
field later is non-breaking); created/updated/noop change status
(CLI-event-only in alchemy — recorded non-goal); any `--json`/parent-process
consumer (future transport, own design); destroy-path reporting (the bin
zeroes actions on destroy — nothing renders, correct).

## Pre-investigated edge cases

| Case | Ruling |
| --- | --- |
| Action noops on unchanged input | Verified `Plan.ts:1069-1082` — hash-compared against prior state. The `Date.now()` nonce forces `run` every deploy. (`Date.now()` is fine here — it's a report trigger, not artifact input; determinism rules govern artifacts.) |
| Graph nodes in action input | FORBIDDEN — plan-time `hashInput` serializes the resolved input; nodes carry functions/Standard Schemas. Addresses + primitives only; the join uses the closure. |
| Output ordering vs alchemy's TUI | The action runs inside the apply session, so the summary may print before alchemy's final status flush. Verify visually in D4; if interleaving is ugly, accepted for this slice and recorded as an upstream ask — do NOT reach for stdout piping. |
| Plan-time `resolveInput` on first deploy | Action inputs referencing not-yet-created resources must still plan (alchemy's own feature contract for actions). D1 includes a probe verifying an action with resource-referencing input plans+runs on a fresh stack; if it fails, STOP → discussion mode (spec amendment), do not improvise a fallback. |
| `lowering()` unit tests | Sync tests run without `report` and never touch alchemy context; the report path is covered by `joinDeployment` (pure), renderer (pure), generate-stack snapshots, and D4's live deploy. |

## Slice-DoD

- A real deploy of `examples/storefront-auth` (or the dogfood app) prints
  the pinned tree with real ids/URLs after apply, on BOTH a changed and an
  unchanged (all-noop) redeploy.
- No alchemy stack-output blob in the deploy output.
- PR #101 closed with the supersession comment.

## References

- Project spec: [../../spec.md](../../spec.md) · design notes § "The
  corrected execution model".
- alchemy `2.0.0-beta.59`: `src/Action.ts:85-135`, `src/Plan.ts:1040-1100`,
  `src/Apply.ts:1103-1232`, `src/Cli/commands/deploy.ts:171-175`.
- `packages/0-framework/3-tooling/cli/src/generate-stack.ts:50-70`.
