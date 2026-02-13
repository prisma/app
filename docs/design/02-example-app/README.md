# Example app (anchor)

This fictional app exists to keep design discussions concrete.

## Minimal topology

- **Ingress (public HTTP)** → **Compute service** (runs an Express server)
- Compute service → **Prisma Postgres** (database resource)

We intentionally do **not** model individual HTTP endpoints here; we only care that incoming requests reach the service.

## Why this matters

This example is the simplest instance of:

- Control plane: infer topology, emit manifest/artifacts, provision dependencies
- Execution plane: execute an entrypoint with injected bindings (no globals)

As streaming becomes central, we can extend this example with:

- Durable Stream resources
- Stream consumers/producers in compute services
- Client streaming delivery (SSE/WebSockets) built on streams
