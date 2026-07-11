# Scheduled work (cron)

How the framework runs work on a schedule. Rests on
[ADR-0020](../90-decisions/ADR-0020-scheduled-work-is-a-driver-not-a-resource.md)
(cron is a driver, not a resource) and the structured build-time param from
[`config-params.md`](config-params.md).

## Cron is a driver

A resource is something a consumer calls — you `load()` a client and invoke it.
Cron is the opposite: it calls *you*. So it is not a binding a consumer loads; it is
a caller. Seen that way it needs nothing new — a caller is an ordinary consumer of
the callee's exposed endpoint, the same shape as a storefront depending on an auth
service's RPC port. This is why cron and object storage, though both built from
composition, sit on opposite sides of the dependency arrow and share no "emulated
resource" mould.

## The three units

```
Cron system  (input: the target's interface)
├── cron-scheduler   depends on trigger(jobId); holds the timer; jobs as a param
└── router           exposes trigger(jobId); depends on the target; switch(jobId) → work
```

**`cron-scheduler`** — reusable, shipped by the framework. A service whose only
dependency is a `trigger(jobId)` endpoint and whose param is the schedule. Its
runtime reads the schedule, sets a timer per entry, and calls `trigger(jobId)` when
one is due:

```ts
compute({
  name: 'scheduler',
  params: { jobs },                       // the schedule — build-time (below)
  deps:   { trigger: rpc(triggerContract) },
  build:  node({ /* timer loop */, scaleToZero: false }),
});
```

**`router`** — the user's. It implements `trigger(jobId)` and routes each id to real
work, depending on the target service to do it. There is no cycle: the scheduler
depends on the router, the router does not depend on the scheduler.

**`Cron` system** — wraps the two, takes the target's interface as its input, and
wires `scheduler.trigger → router`, `router.target → input`.

## The schedule is build-time data

The jobs are a param on the scheduler, baked in at deploy — not registered at
runtime. This is forced by two facts. A running instance is stateless and gets
recycled, so a runtime-registered schedule is lost on restart. And a future native
lowering can only translate what is in the graph at deploy, so a schedule that only
exists in a booted instance's memory is invisible to it. Build-time job config is
what makes both realizations work: the emulated scheduler re-reads it from config on
every boot, and a native scheduler reads the same static table to emit platform
triggers.

Because the schedule is a structured value, it rides on a structured, schema-typed
param — the worked example in [`config-params.md`](config-params.md). Its serializer
is the deploy target's; the schedule round-trips through stored config like any
param.

## One clock, not one per job

The `jobId` travels as data through a single fixed `trigger(jobId)` dependency, so
adding jobs never adds services or ports. A single always-on scheduler fans out to
every job through the router's `switch(jobId)`. This matters because the emulated
scheduler must stay warm — Prisma Compute has no timer and scales to zero, so the
scheduler runs with scale-to-zero disabled, a small standing cost we pay once per
app, never per job.

## Authoring surface

Two utilities keep the jobs and their handlers in sync, modelled on `serve()`.
`defineSchedule` produces the `jobs` param the scheduler reads; `serveSchedule`
produces the router's `trigger` handler and forces a handler for every declared job,
exactly as `serve()` forces one per exposed method:

```ts
// jobs.ts — static; imported at deploy (sets the param) and at boot (the handlers)
export const schedule = defineSchedule({ tick: '60s', mrr: '24h' });

// router server.ts
const { ingest } = service.load();
export default serveSchedule(service, schedule, {
  tick: () => ingest.tick(),
  mrr:  () => ingest.refreshMrr(),
});   // omit a jobId → type error

// system.ts — the user composes it, target wired in
provision('cron', cron(schedule, router), { ingest: ingestRef.rpc });
```

The jobIds have one source of truth, checked by the type system.

## Emulated now, native later

The emulated realization is the always-on scheduler service above. A native
realization — once the platform has a scheduler — lowers the same `jobs` into
platform triggers that call `router.trigger(jobId)` directly, and drops the standing
service. Nothing in the user's code moves, because the router only ever talks to the
`trigger` interface and the schedule is static data both realizations read. The
switch is a realization behind one interface, not an app change.

## Not in scope (v1)

Durable, exactly-once, or dynamic (runtime-registered) scheduling. With the schedule
baked in and idempotent, self-healing targets, the scheduler holds no state. These
are added only when a real consumer needs them.

## Related

- [ADR-0020](../90-decisions/ADR-0020-scheduled-work-is-a-driver-not-a-resource.md) —
  the decision.
- [`config-params.md`](config-params.md) — the structured build-time param the
  schedule rides on.
- [`system-composition.md`](system-composition.md) — the composition the `Cron`
  system uses.
- [`connection-contracts.md`](connection-contracts.md) — the `rpc`/`serve` mechanism
  `trigger` and `serveSchedule` build on.
