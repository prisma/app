# Dispatch plan: rpc-cold-start (idempotency keys)

Contract source: [spec.md](spec.md). Branch:
`claude/streams-cold-start-rpc-37e5c1` off merged main (`2bafbbf`). Three
dispatches, sequential; hostile reviewer round after D1+D2, then D3 closes.
Orchestrator owns all docs (`gotchas.md`, `.drive/`, `docs/`) — implementers
report staleness, never edit. Evidence rules from the streams slice apply
verbatim: raw program output only; every reported number is checked against
the code's real format strings before it is believed.

## D1 — the keyed protocol: client retry + serve() idempotency control

**Outcome:** `makeClient` mints one `Idempotency-Key` per logical call,
reuses it across a bounded retry (250 ms / ×2 / 5 s cap / 5 attempts /
jitter; retry network errors + 5xx + 429, never other 4xx). `serve()`
enforces the key (keyless → loud 400), runs single-flight per in-flight
key, replays completed 2xx/4xx answers for ~60 s under an LRU bound, does
not cache 5xx/throws, and passes `ctx.idempotencyKey` as an optional second
handler argument. No `idempotent` flag exists. No prisma-cloud imports —
this is generic RPC semantics; PRO-217/PRO-219 are named as motivating
urgency only.

**Completed when:** every wire-counted and serve() test in the spec is
green with teeth confirmed red-by-mutation (including the same-key-across-
attempts and fresh-key-per-call assertions); one-argument handlers still
typecheck (`test-d`); both rpc-consuming example suites pass unchanged;
repo checks green; committed with DCO dual sign-off.

## D2 — the canary (scripts + CI)

**Outcome:** `scripts/rpc-cold-start-canary.ts` + `-classify.ts` + unit
tests, inheriting the cold-start canary's proven contract wholesale
(promote-race trigger, ≥60 s spacing including sample #0, log-confirmed
coldness with the 2 s margin, 14-hold bug-gone budget, first-close early
exit, `MAX_RUN_MS`, requirable exits, bug-gone message that retires the
canary + gotchas entry but NEVER the retry or keys); job in
`e2e-deploy.yml` over `examples/storefront-auth`, probing the auth
service's rpc endpoint with a bare single-attempt `fetch` and a manually
minted key — never through a framework client, which would mask the bug.

**Completed when:** classify tests green with confirmed teeth;
`test:scripts` green; at least one live run reports `bug-present` with raw
per-sample output (a clean run today means a broken canary — stop and
report, do not ship); workspace left clean with project counts; committed.

## D3 — hostile review, live re-proof, docs, PR

**Outcome:** reviewer pass over D1+D2 (attack priorities: a repeated key
can never double-execute within an instance; the replay cannot leak one
caller's response to a different logical call; keyless rejection cannot be
bypassed; the canary cannot be masked by the retry machinery; every
reported number is real). Findings closed. Full live round (deploy
storefront-auth, canary verify, destroy, zero leaks). Orchestrator writes
the gotchas PRO-217 RPC-face entry including the documented residual
window, and the design-notes record. PR opened against main with the slice
narrative; review requested from Will. No auto-merge; merge on his word.
