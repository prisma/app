# ADR-0037: Service RPC calls carry an idempotency key, so every call is safely retryable

## Status

Accepted

## Decision

Every service RPC request carries an `Idempotency-Key` header. The client
mints one key per logical call and reuses it on every retry of that call; the
server requires it, runs one call per key, and replays a completed answer to a
repeat. Because duplicates are absorbed by the protocol rather than by a
promise from the method author, the client retries **every** method — there is
no per-method opt-in.

```
POST /rpc/placeOrder                        POST /rpc/placeOrder
Idempotency-Key: 9f2c…e1                    Idempotency-Key: 9f2c…e1   ← same key, retry
Authorization: Bearer <service key>
                                            server: this key already ran →
  ✗ connection closed mid-boot                       replay its answer, do not
                                                     run the handler again
```

A handler may read the key when it wants a stronger guarantee than the
framework's own:

```ts
serve(service, {
  orders: {
    // `ctx` is optional — existing two-argument handlers are unaffected.
    placeOrder: async (input, deps, ctx) => {
      await deps.db.insert({ ...input, requestKey: ctx.idempotencyKey });
      return { placed: true };
    },
  },
});
```

## Reasoning

A service that has scaled to zero has to boot before it can answer, and a
caller's first request can be dropped while that happens — the connection is
closed during establishment, before any handler runs. The obvious repair is for
the client to retry, and the obvious objection is that a retried `POST` may
execute a write twice.

The first design that suggests itself is to let each method say whether it is
safe to repeat — `rpc({ input, output, idempotent: true })` — and retry only
the methods that say yes. It should be rejected, and the reason generalizes:
idempotence is a property of what a handler does to state, so nothing at the
RPC layer can check the claim. The framework would be retrying on an assurance
it cannot verify, and the failure mode is silent — a method marked wrongly
duplicates writes with nothing to catch it. An unverifiable flag is also an
invitation to omission: the safe default is "not idempotent", so the common
outcome is that nobody marks anything and the mechanism protects nothing.

An idempotency key inverts that. The client mints one identifier per logical
call — not per attempt — so every retry of that call is recognizable as the
same call, and two genuinely separate calls never collide. The server keys its
work on it: a duplicate that arrives while the first attempt is still running
waits for that attempt instead of starting a second one, and a duplicate that
arrives after an answer was produced receives that same answer without the
handler running again. Duplicate suppression becomes a mechanism the framework
enforces, so the method author is asked for nothing, and every method is
retryable.

What counts as "an answer" matters. A `2xx` and a `4xx` are both conclusions —
the call succeeded, or it was rejected — and replaying either is correct. A
`5xx` or a thrown error is not a conclusion; it is the outcome a retry exists
to escape, so those are never remembered and a retry re-executes. The memory of
answers is bounded in time and in size: it exists to absorb the retries of a
call still in flight, not to serve as a general result cache, so it holds a
fixed number of recent answers for about a minute.

Making the key required rather than optional is what keeps the guarantee
whole. A server that accepts keyless requests silently loses deduplication for
any caller that forgets one, and "required" enforced by documentation is not
enforced. A keyless request is therefore rejected outright, and the rejection
names the header so the fix is obvious to whoever hits it — including a person
with `curl`.

Retrying is now permanent behavior of this kind, not a workaround for one
platform's cold starts. Keyed retries are correct on any transport that can
drop a request, so nothing here is written to be deleted later, even though
one platform's specific behavior is what made shipping it urgent.

### What this guarantees, and what it does not

[`connection-contracts.md`](../10-domains/connection-contracts.md) sets the
scope this calibrates against: a connection is internal because both ends
belong to one application's topology, not because they share a network, and
robustness is justified per edge against the named failure modes of the
targets carrying it.

The named failure here is a request dropped while its target boots. That
happens before a handler runs, so nothing was applied and a retry cannot
duplicate work — the keys are not what makes that case safe. What the keys add
is the narrower case where a handler did run and its answer was lost on the way
back: the retry finds the recorded answer instead of running the work twice.

The server's memory of answers lives in the serving process, so it cannot cover
a retry that reaches a *different* instance than the one that did the work —
after an instance dies mid-request, or on an edge whose retries may be routed
elsewhere. That residue is deliberate. Closing it would put a durable store
behind every provider, and no supported target's failure modes ask for that
today. An edge that does need it has the tool without the framework imposing
it: the handler receives the key and can record it inside its own transaction,
making its own work exactly-once by its own storage's guarantees.

## Consequences

- **Every method is retryable, and no contract declares anything.** Adding
  retry behavior needs no change to a contract, a method, or a handler.
- **A keyless request is a `400`.** Any caller that is not the generated
  client — a test fixture, a `curl` command — must send a key.
- **Handlers may take a third argument** carrying the key. Existing
  two-argument handlers are unaffected; the argument is optional.
- **A provider holds a bounded amount of recent answers in memory**, sized to
  absorb in-flight retries rather than to grow with traffic.
- **Cross-instance duplicate suppression is the handler's to add**, using the
  key it is given, when its target's failure modes warrant it.

## Alternatives considered

- **Per-method `idempotent: true`, retry only marked methods.** Rejected: the
  framework cannot verify the claim, a wrong mark duplicates writes silently,
  and the safe default guarantees under-marking. The key replaces a promise
  with a mechanism.
- **Retry everything without keys.** Rejected: it converts a visible failure
  into a silent duplicate write, on the assumption that every handler is
  repeat-safe — the same unverifiable claim, made on the author's behalf.
- **Durable, cross-instance deduplication in the framework.** Rejected here:
  it puts a storage dependency behind every provider to close a window no
  supported target's named failure modes call for. The handler can reach that
  guarantee for the edges that need it, using the key this decision gives it.
- **Client-side retry only, with no server-side deduplication.** Rejected: it
  is exactly retry-without-keys from the caller's side, and leaves the
  ambiguous case — answer lost after the work was done — duplicating.
