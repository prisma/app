# Architectural Principles

These are structural constraints that shape MakerKit’s architecture and package boundaries.

## No globals in user applications (DI-only)

User application code must not depend on ambient globals for platform configuration or platform services. It should only ever depend on **injected dependencies**.

Implications:

- **No environment variables for provisioned services**: user code must not read `process.env`, `Bun.env`, `Deno.env`, `import.meta.env`, etc. to find database URLs, bucket names, stream ids, ports, etc.
- **No implicit platform APIs**: user code should not “discover” ingress, ports, bindings, or services by reaching into global state or “magic” configuration.
- **Everything important is a parameter**: resources like Postgres, Storage, Streams, Scheduler, and platform config are passed to entrypoints explicitly (directly or via a typed context object).

## Code-first topology (generated manifest)

The application’s topology is defined in TypeScript (descriptors) and MakerKit generates the deployment metadata (e.g. `makerkit.map.json`) from that code.

Wrangler is an inspiration for end-to-end developer experience, but MakerKit avoids a hand-authored manifest as the source of truth to prevent drift.

## Two-plane architecture: control plane vs execution plane

MakerKit must operate in two modes:

- **Control plane**: import descriptors, validate/normalize, build topology graph, emit metadata/artifacts, provide handles for provisioning/inspection.
- **Execution plane**: instantiate implementations, satisfy the graph, perform DI, run entrypoints.

To prevent drift, keep separate import surfaces (e.g. `@prisma/makerkit/control` vs `@prisma/makerkit/runtime`) and avoid cross-plane coupling.
