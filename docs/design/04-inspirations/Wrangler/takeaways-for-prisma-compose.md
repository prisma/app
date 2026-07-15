# Wrangler → Prisma Composer takeaways (evolving)

This doc is explicitly **not** "research." It records what we currently believe Prisma Composer should emulate/adapt from Wrangler, and it is expected to change as the framework's design evolves.

Primary reference: [Wrangler documentation](https://developers.cloudflare.com/workers/wrangler/)

## The core interaction pattern to base Prisma Composer on

**Config (or descriptors) as source of truth → validate → build artifact → dev locally with parity → deploy.**

That is the foundational shift away from:

- ad-hoc scripts and scattered config
- "prod works, local is a guess" dev workflows

## What we want to emulate directly

- **Clear artifact boundary**
  - Make it obvious what the "deployment unit" is (our equivalent of topology map + bundle).
- **Human-friendly validation**
  - Errors tied to authoring source (TypeScript descriptors); actionable, not cryptic.
- **Local-prod parity**
  - Local mode uses the same conceptual model and contracts as production; optional remote bindings for specific resources.
- **Command surface clarity**
  - `init`, `dev`, `deploy`, `check`, resource-management subcommands; consistent `--config`, `--env` semantics.
- **Environment abstraction**
  - Staging vs production as first-class env selection; inheritable vs non-inheritable config keys.

## What we likely need to adapt for Prisma Composer

- **Source of truth**
  - Wrangler: hand-authored manifest (`wrangler.toml` / `wrangler.jsonc`).
  - Prisma Composer: code-first descriptors; manifest/artifacts **generated** from TypeScript, not authored by hand.
- **Binding model**
  - Wrangler: explicit bindings in config; IDs or auto-provision.
  - Prisma Composer: inferred topology from descriptors; bindings derived from topology map.
- **Build pipeline**
  - Wrangler: esbuild default; custom build escape hatch.
  - Prisma Composer: descriptor compilation → topology map → platform-facing bundle/artifacts.

## Artifact boundaries (emphasized)

- Wrangler's artifact = bundle + resolved config (routes, bindings, limits).
- Prisma Composer's artifact = `prisma-composer.map.json` (or equivalent) + per-entrypoint bundles.
- Both: artifact is the contract between author-time and runtime; what gets deployed is explicit.

## Validation UX (emphasized)

- Schema-driven config validation (Wrangler uses JSON Schema).
- `wrangler check` validates Worker before deploy.
- Prisma Composer: validate descriptors early; errors with file:line and clear remediation.

## Command surface (emphasized)

- Lifecycle: init, dev, deploy, delete.
- Validation: check.
- Observability: tail (logs).
- Resource management: domain-specific subcommands (d1, kv, r2, ...).
- Prisma Composer equivalents: define minimal set; avoid command sprawl.

## Open questions / assumptions

- What are Prisma Composer's "Wrangler equivalents" for: init, dev, deploy, check, tail?
- What are the minimal stable artifacts we need (topology map schema, bundle format)?
- How do we expose "remote binding" semantics for resources that can't be simulated locally?
- Should we support environment selection (`--env`) with inheritable vs non-inheritable keys in our generated manifest?

# Wrangler → Prisma Composer takeaways (evolving)

This doc is explicitly **not** “research.” It records what we currently believe Prisma Composer should emulate/adapt from Wrangler, and it is expected to change as the framework’s design evolves.

Primary reference: [Wrangler documentation](https://developers.cloudflare.com/workers/wrangler/)

## The core interaction pattern to base Prisma Composer on

**Config (or descriptors) as source of truth → validate → build artifact → dev locally with parity → deploy.**

That is the foundational shift away from:

- ad-hoc scripts and scattered config
- “prod works, local is a guess” dev workflows

## What we want to emulate directly

- **Clear artifact boundary**
  - Make it obvious what the “deployment unit” is (our equivalent of topology map + bundle).
- **Human-friendly validation**
  - Errors tied to authoring source (TypeScript descriptors); actionable, not cryptic.
- **Local-prod parity**
  - Local mode uses the same conceptual model and contracts as production; optional remote bindings for specific resources.
- **Command surface clarity**
  - `init`, `dev`, `deploy`, `check`, resource-management subcommands; consistent `--config`, `--env` semantics.
- **Environment abstraction**
  - Staging vs production as first-class env selection; inheritable vs non-inheritable config keys.

## What we likely need to adapt for Prisma Composer

- **Source of truth**
  - Wrangler: hand-authored manifest (`wrangler.toml` / `wrangler.jsonc`).
  - Prisma Composer: code-first descriptors; manifest/artifacts **generated** from TypeScript, not authored by hand.
- **Binding model**
  - Wrangler: explicit bindings in config; IDs or auto-provision.
  - Prisma Composer: inferred topology from descriptors; bindings derived from topology map.
- **Build pipeline**
  - Wrangler: esbuild default; custom build escape hatch.
  - Prisma Composer: descriptor compilation → topology map → platform-facing bundle/artifacts.

## Artifact boundaries (emphasized)

- Wrangler’s artifact = bundle + resolved config (routes, bindings, limits).
- Prisma Composer’s artifact = `prisma-composer.map.json` (or equivalent) + per-entrypoint bundles.
- Both: artifact is the contract between author-time and runtime; what gets deployed is explicit.

## Validation UX (emphasized)

- Schema-driven config validation (Wrangler uses JSON Schema).
- `wrangler check` validates Worker before deploy.
- Prisma Composer: validate descriptors early; errors with file:line and clear remediation.

## Command surface (emphasized)

- Lifecycle: init, dev, deploy, delete.
- Validation: check.
- Observability: tail (logs).
- Resource management: domain-specific subcommands (d1, kv, r2, ...).
- Prisma Composer equivalents: define minimal set; avoid command sprawl.

## Open questions / assumptions

- What are Prisma Composer’s “Wrangler equivalents” for: init, dev, deploy, check, tail?
- What are the minimal stable artifacts we need (topology map schema, bundle format)?
- How do we expose “remote binding” semantics for resources that can’t be simulated locally?
- Should we support environment selection (`--env`) with inheritable vs non-inheritable keys in our generated manifest?
