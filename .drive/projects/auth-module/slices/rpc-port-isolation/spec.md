# Slice S5 (proposed): wired egress — spec draft v2

> Status: **draft, pending operator confirmation of scope/sequencing.**
> Shape settled with Will 2026-07-23: listening is a wired capability, not
> an ambient right. This v2 replaces the v1 draft (path-scoped dispatch +
> per-port key partitioning), which is now the recorded rejected
> alternative — it hardened the flat listener instead of removing its
> ambient existence.

## The model

A service's exposed surfaces reach the network only through wiring:

1. **rpc ports: mount-iff-wired, zero new authoring.** A consumer edge is
   the justification for a port to exist on the network. The lowering
   mounts an rpc port iff ≥1 consumer wired it; the mount's accepted keys
   are exactly that port's edge keys (already minted per binding). An
   unwired admin port is not 401-protected — it is **absent**. The rpc
   binding itself carries the egress information (address/port + key land
   in the consumer's connection params, as today).
2. **Public egress: the one new representation.** "Expose publicly" is the
   boundary to the world outside our topology — the only consumer that has
   no in-graph edge. It becomes an explicit binding the root supplies at
   `provision()` (need/source split, same rail family as
   `envSecret`/`envParam`; source is target-owned). A non-rpc surface
   (auth's `api`) with no binding — public or in-graph — is not served.
3. **Per-surface listeners.** Each mounted surface gets its own port on
   the service's address if the platform supports multiple ports per
   service (ignite grounding in progress); otherwise the v1-lowering is
   per-mount path prefixes on the single listener, with the authoring
   model unchanged and the lowering upgraded later. Either way the mount
   set and key sets derive from wiring.

Strongest available wiring for auth (to be the example's recommended
shape): do NOT bind `api` to public egress at all — wire it only to the
consumer app's `authApi()` edge, key-checked like any edge (carried on a
non-`Authorization` header so Better Auth's bearer plugin keeps its own).
The auth service then has zero public surface; public exposure happens at
the storefront, which mounts the proxy on its own origin.

## Consequences

- Cross-port method-name collisions stop mattering (per-surface mounts);
  `serve()`'s cross-port uniqueness restriction is lifted. `findUser`
  stays (clearer name; zero churn).
- Email inherits the same semantics on redeploy: its `outbox` port
  becomes absent unless wired — the least-privilege claim in its D4
  becomes transport-true.
- The admin path's "admin ports are reachable only if wired" stops being
  a deferral and becomes the literal mechanism — feed to the admin-path
  design pass as its first settled convention.
- The entrypoint no longer assumes the reserved `port`: it serves what
  its bindings tell it (this is the "no globals" principle reaching the
  listen socket).

## Scope

**In:** `@internal/service-rpc` (mount derivation, serve construction),
target lowering (mount set from edges; public-egress source + need; key
sets per mount; listener allocation per the ignite answer), entrypoint
contract for multi-surface services (auth, email), examples updated, ADR
amending ADR-0030 (+ possibly a new egress ADR).

**Out:** per-method authz (still deferred), admin UI tiers.

## Grounding: the ignite answers (2026-07-23)

1. **Multi-port: NO, and none specced.** The whole shipped chain is
   one-port-per-version, one-URL-per-service: `--httpPort`/`{ http }` is
   a scalar (ignite ADR 0006), the build attaches ONE port mapping per
   `ComputeVersion`, Foundry's `Endpoint` maps one single-label hostname
   prefix → one version (wildcard-TLS hard-limits nesting, ADR 0008),
   `ComputeService` carries a single `endpointDomain`. No
   `ports[]`/named-endpoint construct exists anywhere in the compute
   API/manifest to build on.
2. **No private networking / in-workspace addressing for compute** —
   every service URL is public by default with no opt-out; a "private
   network provided with every Prisma project" + inter-service invocation
   appear only in the 2026 product-strategy doc as future work.

**Consequence:** v1 lowering is per-mount path prefixes on the single
public listener — mount set and per-mount key sets derived from wiring;
"absent" means not-routed (404 at our router, no handler existing), not
not-listening. The authoring model is unaffected and the lowering
upgrades without authored-code changes when multi-port/private
networking land. The proxy-only `api` wiring stays valid: the listener
is publicly reachable, but the api mount demands the proxy edge's key.
Worth filing the platform ask (multi-port or private services) with the
platform team, referencing their own strategy line about the project
private network.
3. The provisioner edge's target-port identity (rpc rail) — confirm
   `edge` exposes it or grow it.
4. Public-egress source naming + which ADR shape (amend 0030 vs new).

## Slice DoD

- An unwired port's route/listener does not exist on the deployed
  service (proven by the smoke: connection refused or 404-at-router, per
  the ignite answer — not 401).
- A consumer wired to one port cannot reach another port with its key
  (real serve()+makeClient integration test).
- Auth example runs with the proxy-only wiring (auth service has no
  public binding); email example redeploys with no authoring change.
- serve()'s cross-port duplicate-method restriction lifted.
