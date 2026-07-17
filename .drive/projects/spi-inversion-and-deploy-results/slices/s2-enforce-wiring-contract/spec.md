# S2 — Enforce the wiring contract

## At a glance

A producer that fails to supply a consumer's declared connection param
today yields a silent `undefined` serialized into the consumer's
environment — the failure surfaces at the consumer's boot, far from the
mistake. Under the inverted seam (ADR-0033) the consumer's connection
declaration is the contract; this slice makes under-delivery a loud
`LowerError` at deploy time, naming the edge. Operator-confirmed behavior
change (2026-07-17).

## Chosen design

All changes in `packages/0-framework/1-core/core/src/deploy.ts`,
`buildConfig`'s inputs loop — the one place the contract is resolved.

Current loop body (post-S1 shape):

```ts
const producedOutputs = edge !== undefined ? (lowered.get(edge.from) ?? {}) : {};
const values: Record<string, unknown> = {};
for (const [name, param] of Object.entries(inputNode.connection.params)) {
  values[name] =
    param.provision !== undefined
      ? provisioned.get(`${id}.${inputName}`)
      : producedOutputs[name];
}
```

New behavior — inside the same `for` loop, for the non-provisioned branch
only, when **an edge exists**:

```ts
const value = producedOutputs[name];
if (value === undefined && param.optional !== true && edge !== undefined) {
  throw new LowerError(
    `Connection input "${id}.${inputName}" declares param "${name}", but its producer ` +
      `"${edge.from}" did not supply it — the producer's wiring outputs carry ` +
      `[${Object.keys(producedOutputs).join(', ') || 'nothing'}]. Add "${name}" to the ` +
      `producer's returned wiring outputs, or declare the param optional on the connection.`,
  );
}
values[name] = value;
```

Pinned rulings:

- **`throw`, not `Effect.fail`** — matches `resolveParam`'s existing idiom
  in the same file; consistency wins over channel purity here.
- **`value === undefined` is the test** (not `name in producedOutputs`): a
  producer explicitly setting a key to `undefined` counts as missing —
  matches `resolveParam`'s bound-detection idiom.
- **Presence check only, no schema validation.** Wiring values at lowering
  time are routinely alchemy `Output` proxies (e.g. `deployment.deployedUrl`)
  — symbolic references that no Standard Schema can validate before apply
  resolves them. Record this as a code comment on the check, so nobody
  "completes" the enforcement later without noticing the proxy fact.
- **`edge === undefined` keeps today's behavior** (all params resolve
  `undefined`, no error). An unwired input is a graph-construction concern,
  out of this slice's scope; the check must not change that path.
- **Provisioned params are exempt** — the mint supplies them (ADR-0031);
  the `param.provision !== undefined` branch is untouched.
- **`param.optional === true` is exempt** — the consumer said absent is
  legal; boot-side `coerce()` already reads a missing var as `undefined`.

## Coherence rationale

One guard clause, one error message, a handful of tests — a reviewer holds
the entire semantic change (silent → loud) in one screen of diff.

## Scope

**In:** the guard, its comment, its tests.
**Deliberately out:** schema validation of wiring values (impossible
pre-resolution — see ruling); unwired-input handling; any descriptor
change (none should be needed — if a descriptor pair fails the new check
in tests or dogfood, that is a real latent bug, fixed as its own commit in
this slice with the failure named in the PR body).

## Pre-investigated edge cases

| Case | Ruling |
| --- | --- |
| s3-store's D4a↔D4b check | Its own serialize-time error stays — it guards `config` fields, not wiring presence; no overlap, no removal. |
| Optional connection params in existing modules | `coerce()`'s missing-var-as-absent contract (compute.ts serialize comment) is exactly the exempted path — unchanged. |

## Slice-DoD

New `lowering.test.ts` cases, all green:

1. Producer omits a declared required param → deploy fails with a
   `LowerError` whose message contains the edge id (`consumer.input`), the
   param name, the producer id, and the producer's actual key list.
2. Producer omits a declared `optional` param → lowering succeeds; the
   consumer's config carries `undefined` for it.
3. A provisioned param with no producer-supplied value → untouched by the
   guard (mint path).
4. Unwired input (no edge) → today's behavior, no error.

## References

- Project spec: [../../spec.md](../../spec.md) · builds on S1's
  `WiringOutputs` seam.
- `packages/0-framework/1-core/core/src/deploy.ts:237-250` (the loop),
  `:178-218` (`resolveParam`'s idioms this mirrors).
