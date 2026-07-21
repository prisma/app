# ADR-0037: Service RPC calls carry an idempotency key, so every call is safe to retry

## Status

Accepted

## Decision

Every call the generated service-RPC client makes carries an `Idempotency-Key`
header: one key per logical call, reused on every retry of that call. The
provider runs one call per key — a duplicate that arrives while the first is
still running waits for it, and a duplicate that arrives after an answer
replays that answer without running the handler again. Because duplicates are
absorbed by the protocol, **every method is retryable and no method declares
anything** — there is no per-method "is this safe to retry" flag.

```
POST /rpc/placeOrder                     POST /rpc/placeOrder
Idempotency-Key: 9f2c…e1                 Idempotency-Key: 9f2c…e1   ← same key, a retry
Authorization: Bearer <service key>
                                         provider: this key already ran →
  ✗ connection dropped mid-boot                    replay its answer, don't
                                                    run the handler again
```

A handler that needs a stronger guarantee than the provider's own memory reads
the key from an optional third argument; handlers that don't are unchanged:

```ts
serve(service, {
  orders: {
    placeOrder: async (input, deps, ctx) => {
      // ctx.idempotencyKey lets a handler make its own work exactly-once.
      await deps.db.insert({ ...input, requestKey: ctx.idempotencyKey });
      return { placed: true };
    },
  },
});
```

## Reasoning

A service that has scaled to zero must boot before it can answer, and the
caller's first request can be dropped while it does — the connection is closed
during establishment, before any handler runs. The repair is for the client to
retry; the objection is that a retried `POST` might run a write twice. The key
is what turns the retry from dangerous into safe.

The client generates one identifier per logical call — not per attempt — and
sends it on every attempt of that call. So a retry is always recognizable as
the same call, and two genuinely separate calls never collide. The provider
keys its work on it: a second request for a key still in flight waits for the
first instead of starting a second execution, and a second request after the
first has answered gets that same answer back. Duplicate suppression is a
mechanism the framework runs, so the method author is asked for nothing and
every method is retryable.

What counts as "an answer" is the load-bearing distinction. A `2xx` and a `4xx`
are both conclusions — the call succeeded, or it was rejected — so replaying
either is correct. A `5xx` or a thrown error is not a conclusion; it is the
outcome a retry exists to escape, so it is never remembered and a retry
re-executes. The memory of answers exists only to absorb the retries of a call
still in flight, not to serve as a general result cache, so it holds a fixed
number of recent answers for about a minute.

The key is what makes retrying safe, and it lives entirely in the generated
client, which pairs "mint a key" with "retry" inseparably and always sends the
key. A request that arrives *without* a key therefore never came from that
client — it is a hand-rolled or older caller — so it is run once, with no
deduplication, rather than rejected. This keeps the safe path automatic (the
generated client is always keyed) while letting an out-of-band caller, or a
`curl` during debugging, work transparently. The handler sees the key as
`undefined` for such a call and decides for itself whether that is acceptable.

Retrying is permanent behavior of this kind, not a workaround for one platform.
Keyed retries are correct on any transport that can drop a request, so nothing
here is written to be removed later.

### What this guarantees, and what it does not

[`connection-contracts.md`](../10-domains/connection-contracts.md) sets the
scope this calibrates against: a connection is internal because both ends
belong to one application's topology, not because they share a network, and
robustness is justified per edge against the named failure modes of the targets
carrying it.

The failure this guards is a request dropped while its target boots. That
happens before a handler runs, so nothing was applied and a retry cannot
duplicate work — the keys are not what make *that* case safe. What the keys add
is the narrower case where a handler did run and its answer was lost on the way
back: the retry finds the recorded answer instead of running the work twice.

The provider's memory of answers lives in the serving process, so it cannot
cover a retry that reaches a *different* instance than the one that did the work
— after an instance dies mid-request, or on an edge whose retries route
elsewhere. That residue is deliberate: closing it would put a durable store
behind every provider, and no supported target's failure modes call for that.
An edge that does need it has the tool without the framework imposing it — the
handler receives the key and can record it inside its own transaction, making
its own work exactly-once by its own storage's guarantees.

## Consequences

- **Every method is retryable, and nothing declares it.** Retry behavior needs
  no change to a contract, a method, or a handler.
- **The generated client always sends a key**, so every framework-to-framework
  call is deduplicated.
- **A keyless request is served once, without deduplication.** A hand-rolled
  request or a `curl` works transparently; a handler's `ctx.idempotencyKey` is
  `undefined` for it.
- **Handlers may take a third argument** carrying the key. Existing
  two-argument handlers are unaffected; the argument is optional.
- **A provider holds a bounded number of recent answers in memory**, sized to
  absorb in-flight retries rather than to grow with traffic.
- **Cross-instance duplicate suppression is the handler's to add**, using the
  key it is given, when its target's failure modes warrant it.

## Alternatives considered

- **A per-method `idempotent: true` flag, retrying only marked methods.**
  Rejected: idempotence is a property of what a handler does to state, so
  nothing at the RPC layer can verify the claim. The framework would retry on
  an assurance it cannot check, and a method marked wrongly would duplicate
  writes with nothing to catch it; the safe default ("not idempotent") also
  guarantees under-marking, so the mechanism would protect almost nothing. The
  key replaces a promise with a mechanism.
- **Retrying without keys.** Rejected: it turns a visible failure into a silent
  duplicate write, on the assumption that every handler is repeat-safe — the
  same unverifiable claim, made on the author's behalf.
- **Rejecting a keyless request outright.** Rejected: the only caller that can
  omit a key is one outside the generated client, for which "no key, no
  deduplication" is the honest and expected behavior; rejecting it breaks
  `curl` and older clients to guard a case the safe path already covers.
- **Durable, cross-instance deduplication in the framework.** Rejected: it puts
  a storage dependency behind every provider to close a window no supported
  target's failure modes call for. A handler that needs it has the key to do it
  itself.
