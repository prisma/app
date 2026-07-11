# ADR-0020: Scheduled work is a driver System, not a loadable resource

## Status

Proposed

## Decision

Cron is modelled as a **driver**: a service that declares a dependency on the thing
it calls and invokes it on a schedule — the mirror image of a resource, which you
call. It is not something a consumer `load()`s. A reusable `cron-scheduler` service
holds the timer and depends on a `trigger(jobId)` endpoint; the user supplies a
`router` that implements `trigger` and routes each `jobId` to real work; the two
compose inside a `Cron` system. The schedule is **build-time configuration** — a
param on the scheduler, not runtime state — so it survives restarts and can be
lowered to a native platform scheduler later without touching the app.

## Reasoning

An ingest service exposes an endpoint that runs one budgeted step, and we want it
called every sixty seconds. The instinct is to model cron like a resource the
service depends on — but the arrow points the wrong way. A resource (postgres,
object storage) is something the consumer *calls*: you `load()` a client and invoke
it. Cron *calls you*. So it isn't a binding a consumer loads; it's a caller.

Seen that way, nothing new is needed. A caller is an ordinary consumer of the
callee's exposed endpoint. The scheduler is a service whose dependency is the target
endpoint, exactly as a storefront depends on an auth service's RPC port:

```ts
// the reusable scheduler — it depends on what it calls
compute({
  name: 'scheduler',
  params: { jobs },                 // the schedule, build-time (see below)
  deps:   { trigger: rpc(triggerContract) },
  build:  node({ /* a timer loop */, scaleToZero: false }),
});
```

At runtime it `load()`s a client to `trigger` and calls `trigger.tick(jobId)` on a
timer. The scheduler depends on the router; the router depends on nothing of the
scheduler's — so there is no dependency cycle, and no reverse-edge primitive to
invent.

**The schedule must be build-time data.** A running instance is stateless and gets
recycled; a schedule registered at runtime (an RPC that tells the scheduler its
jobs after boot) is lost on every restart, and — worse — is invisible to a future
Alchemy lowering that would translate it into a native platform scheduler, because
that lowering can only read what's in the graph at deploy. So the jobs are a param
on the scheduler, baked in at deploy: read from config on every boot, and the exact
static artifact a native lowering reads to emit platform triggers. Build-time job
config is what makes both the emulated and the native realization work.

**One clock, not one per job.** The `jobId` rides as data through a single fixed
`trigger(jobId)` dependency, so adding jobs never adds services or ports. The
scheduler fans out to a `router` the user writes; the router's `switch(jobId)`
dispatches to real work, and the router's own dependency on the target service is
the declared call edge. A single always-on scheduler drives every job — which
matters because the emulated realization keeps that one service warm (scale-to-zero
off) at a small fixed cost, and we will not multiply it per job.

**A utility keeps jobs and handlers in sync**, modelled on `serve()`. `serve()`
forces a handler for every method a service exposes; the scheduling analog forces a
handler for every declared job:

```ts
export const schedule = defineSchedule({ tick: '60s', mrr: '24h' });
// router server.ts:
export default serveSchedule(service, schedule, {
  tick: () => ingest.tick(),
  mrr:  () => ingest.refreshMrr(),
});   // omit a jobId → type error, exactly like a missing serve() method
```

`defineSchedule` produces the `jobs` param the scheduler reads; `serveSchedule`
produces the `trigger` handler that dispatches it. The jobIds have one source.

## Consequences

- **No new composition capability is needed.** A driver is a normal service
  depending on a sibling's exposed endpoint, which system composition already
  expresses. Cron is built from existing primitives.
- **The emulated realization needs an always-on service.** Prisma Compute has no
  timer and scales to zero, so the scheduler runs with scale-to-zero disabled — a
  small standing cost, per app, not per job. This is a recorded limitation and a
  concrete platform ask (a native timer would replace it).
- **Native later is a realization swap behind one interface.** Because the schedule
  is static build-time data and the router only ever talks to the
  `schedule`/`trigger` shape, a native scheduler lowers the same `jobs` into
  platform triggers that call `router.trigger`; the router and its target wiring
  don't change.
- **Cron is not a resource.** It exposes no binding and is never `load()`ed. It sits
  on the opposite side of the dependency arrow from object storage, and the two
  should not share one "emulated resource" mould.
- **v1 holds no state.** With the schedule baked in and idempotent, self-healing
  targets, the scheduler needs no durable store. Durable, exactly-once, or dynamic
  (runtime-registered) scheduling is deliberately out of scope until something needs
  it.

## Alternatives considered

- **Cron as a stateful server you register jobs with at runtime (RPC `/schedule`).**
  Rejected: it hides the call edges from the static graph — the very thing the
  framework derives from source — and it loses jobs on the stateless instance's
  recycle. Build-time config keeps the edges visible and the jobs durable.
- **One scheduler service per job.** Rejected on cost: each is an always-on instance.
  A single scheduler with `jobId`-as-data fans out to many jobs at one standing cost.
- **A reverse-edge / "resource that calls you" primitive in composition.** Rejected
  as unnecessary: reframing the scheduler as a normal consumer of the target's
  endpoint removes the inversion entirely.

## Related

- [`ADR-0018`](ADR-0018-config-params-carry-a-caller-owned-schema.md) /
  [`ADR-0019`](ADR-0019-the-target-owns-config-serialization.md) — the schema-typed,
  target-serialized param the schedule rides on.
- [`ADR-0013`](ADR-0013-resources-are-provisioned-by-systems-deps-are-declarations.md) —
  the resource model this contrasts with (cron is a driver, not a resource).
- [`ADR-0016`](ADR-0016-a-system-has-the-same-boundary-as-a-service.md) — system
  composition, which the `Cron` system uses to wrap scheduler + router.
- [`scheduled-work.md`](../10-domains/scheduled-work.md) — the cron topology and
  authoring surface in full.
