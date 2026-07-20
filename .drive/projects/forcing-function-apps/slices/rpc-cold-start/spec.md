# Slice: RPC idempotency keys — safe retries for every call, with the PRO-217 canary

## At a glance

`rpc()`'s `makeClient` carries no cold-start handling: every service-to-service
RPC edge hits PRO-217's intermittent socket close raw on a cold target — and
PRO-217 is live (reproduced repeatedly on 2026-07-17, log-confirmed cold
starts). A blanket retry was off the table while a retried POST could
double-execute a write.

Settled design (Will, 2026-07-17, superseding an earlier `idempotent: true`
boolean proposal): **the RPC protocol requires an idempotency key on every
call**, and the framework implements idempotency control on both ends. With
the mechanism in place, every method is safely retryable and no per-method
declaration exists — a boolean would be a human claim the framework cannot
check; the key is a mechanism it enforces.

Scope calibration (Will, verbatim intent): this protocol is primarily for
service-to-service calls inside one network, guarding against the cold-start
bug — not arbitrary distributed-systems failure. In-memory idempotency
control is sufficient; exposing the key to handlers is good practice, and it
is acceptable for users to ignore it.

## The design

### Protocol

- Every request `makeClient` sends carries an `Idempotency-Key` header:
  a UUID minted **once per logical call** and reused byte-identically across
  every retry of that call. Two separate calls never share a key.
- The key is REQUIRED: `serve()` rejects a keyless request with a loud 400
  naming the header — "requires" enforced, not suggested. (Manual `curl`
  against an rpc endpoint must supply the header; document in the error.)

### Client (`makeClient`)

- Every method gets a bounded retry: the streams client's numbers (250 ms
  initial, ×2, 5 s cap, 5 attempts, jittered). Retry thrown network errors,
  5xx, and 429; never any other 4xx — a real protocol answer surfaces on the
  first try. Same key on every attempt.
- No per-method configuration. No `idempotent` flag anywhere.

### Server (`serve()`)

- **Single-flight per key:** a duplicate arriving while the first attempt is
  still executing waits for it and receives the same response — the handler
  runs once.
- **Replay window scoped to the retry envelope, not general replay:**
  completed answers (2xx and 4xx — they are answers) are cached ~60 s with
  an LRU bound and replayed byte-identically for a repeated key. 5xx and
  thrown errors are not cached — they are the retryable outcomes, and a
  retry re-executes.
- **Handler context:** handlers gain an optional second argument —
  `(input, ctx)` with `ctx.idempotencyKey` — non-breaking for existing
  handlers. A handler with hard exactly-once needs can write the key into
  its own transaction; the framework does not require it.

### The residual, documented and accepted

In-memory control protects within an instance's lifetime. If an instance
applies a call, dies before responding, and the retry lands on a fresh
instance, the handler runs again. Accepted per the scope calibration above
(narrow window, same-network traffic, and PRO-217's specific failure — a
close mid-connection-establishment — never reached a handler at all, so its
retry was never the dangerous case). The gotchas entry states this window
plainly; no design pretends it is closed.

### Status of the retry: permanent, not a compensation

Bounded retry over keyed calls is correct RPC semantics on any network —
it does NOT get deleted when the platform fixes cold starts. The canary's
bug-gone message therefore retires only the canary itself, the gotchas
paragraph, and PRO-219's urgency framing — never the retry or the keys.

### The canary (PRO-217, RPC face)

A sibling of `scripts/cold-start-canary.ts`, inheriting every rule of its
2026-07-17 rebuild — requirements, not suggestions:

- Fresh target via create → upload → start → **race the promote call**
  (never wait for `running`); ≥60 s between samples, including before
  sample #0; coldness proven from the deployment's own boot log (2 s
  cross-clock margin), never inferred from latency; `bug-gone` needs 14
  confirmed cold-start holds (20% target close rate, ≤5% false-clean); any
  close is decisive; first close exits early; `MAX_RUN_MS` self-stop under
  the job timeout; requirable exits (present → 0, gone → 1 with the cleanup
  message, inconclusive → 0 + `::warning::`).
- **Probes the target's rpc endpoint DIRECTLY with a bare `fetch`** (single
  attempt, manually-minted key): every framework edge now auto-retries, so
  a probe through a consumer would be masked by the machinery this slice
  ships. The raw platform behavior must stay observable.
- Rides `examples/storefront-auth`'s deployed auth service through the
  existing deploy-verify-destroy action; own `-classify.ts` + unit tests;
  own job in `e2e-deploy.yml`; NOT required until Will adds it.

## Verification bar

- **Wire-counted, mutation-verified client tests** (the streams append-test
  pattern, counts asserted at a stub transport): 503-then-success →
  resolves with exactly two requests carrying the SAME key; two separate
  logical calls → different keys; 404 → rejects after exactly one request;
  network-error-then-success → resolves. Teeth: delete the retry → red;
  mint a fresh key per attempt → the same-key assertion reds.
- **serve() tests:** repeated key after completion → handler ran once,
  response replayed byte-identically; concurrent same-key → one execution
  (single-flight); keyless → 400 naming the header; 5xx not cached (a
  retry re-executes); cache eviction bounds. Teeth confirmed per test.
- **Type-level:** existing one-argument handlers still typecheck; `ctx`
  carries the key.
- **Live round:** canary against a fresh deploy, raw output only; expected
  verdict today is `bug-present`. A clean run today means a broken canary —
  investigate, do not report it as a result.
- Repo checks green: typecheck, lint, casts delta 0, depcruise,
  `test:scripts`; `examples/store` and `examples/storefront-auth` compile
  and their integration tests pass unchanged (handlers ignore `ctx`).

## Out of scope

- Durable (cross-instance) idempotency storage — the handler's option via
  `ctx.idempotencyKey`, never a framework requirement.
- Server-initiated replay semantics beyond the retry envelope.
- Adding the canary to the required-checks list (Will's manual step).
- The streams follow-ups (typed `streamDef`, audit debt items) — separate.
