# `@prisma/composer-prisma-cloud/streams`

Durable append-only event streams as a Prisma Composer module. It wraps the
production `@prisma/streams-server` runtime (npm, unmodified) as a Compute
service behind a typed boundary: the module's `store` dependency takes a
`storage()` module's port as its durable tier, and it exposes a single
`streams` port. A consumer's `durableStreams()` dependency hydrates to a
ready **`StreamsClient`** — like RPC's generated client, no app hand-rolls
the protocol; the wire binding underneath is `{ url, apiKey }`, the key
minted by the deploy.

Ships as the `@prisma/composer-prisma-cloud/streams` subpath (like `/storage`).

## Contract scope

Hydration hands a consumer the client:

```ts
interface StreamsClient {
  create(name, opts?): Promise<void>; // ensure-style: an existing stream is success
  append(name, event): Promise<void>; // one JSON event; NEVER retried (no idempotency key)
  read<T>(name, opts?): Promise<{ events: T[]; nextOffset: string }>;
  tail<T>(name, opts?): Promise<{ events: T[]; nextOffset: string; timedOut: boolean }>;
}
```

The wire binding underneath is the typed connection config (ADR-0015) —
`{ url: string, apiKey: string }` — and the client wraps
[`@durable-streams/client`](https://www.npmjs.com/package/@durable-streams/client)
(ElectricSQL's canonical protocol client, pinned to the version
`@prisma/streams-server` 0.1.11's own repo pairs with). The full protocol
surface it drives:

| Op | Notes |
| --- | --- |
| `PUT /v1/stream/{name}` | create (idempotent; `content-type` fixes the stream's type) |
| `POST /v1/stream/{name}` | append a JSON array of events (`stream-closed: true` header closes) |
| `GET /v1/stream/{name}?offset=…` | read from an offset; `-1` = start; `format=json` |
| `GET …&live=long-poll&timeout=…` | held read — returns when fresh events arrive or timeout |
| `GET …&live=sse` | SSE tail (see the deployed live path note below) |

Offsets are **opaque cursors**, not numeric indices: take them from a read's
`nextOffset` and pass them back verbatim.

**Auth rides the binding.** The bearer key is not an ADR-0029 secret (there
is no external value to bind) and not a producer output. The `apiKey`
connection param declares an [ADR-0031](../../../../docs/design/90-decisions/ADR-0031-provisioned-param-values-are-a-need-resolved-through-a-target-registry.md)
**provisioning need**: the deploy target mints the value, keeps it stable in
deploy state, and fills the param like any other input. Declaring a
`durableStreams()` dependency is the whole of the wiring — there is no secret
slot and nothing to bind at the root. Every endpoint, including `/health`,
requires `Authorization: Bearer <key>`.

Two consequences worth knowing:

- **One key per streams module.** The provisioner mints per provider, not per
  edge, because `@prisma/streams-server` authenticates a single `API_KEY` —
  every consumer of one `streams()` instance holds the same value. Cardinality
  is provisioner policy (ADR-0031), so per-edge keys are later a change of
  that policy plus an accepted-set landing once the upstream server takes a
  key set: no resource to add, no core change, nothing here to delete.
- **No consumers, no key.** The need lives on the consumer's edge, so a
  `streams()` module nothing depends on never gets a key minted, and its
  server refuses to boot rather than serve unauthenticated. Wire a consumer,
  or drop the module.

## Wiring

The root provisions `storage()` as the durable tier and wires its `store`
port into `streams()` — the key needs no wiring at all:

```ts
// module.ts — the deploy root
import { module } from '@prisma/composer';
import { storage } from '@prisma/composer-prisma-cloud/storage';
import { streams } from '@prisma/composer-prisma-cloud/streams';
import worker from './src/worker/service.ts';

export default module('my-app', ({ provision }) => {
  const store = provision(storage());
  const events = provision(streams(), { deps: { store: store.store } });
  provision(worker, { deps: { streams: events.streams } });
});
```

```ts
// src/worker/service.ts — the consumer. Declaring the dependency is what
// causes the key to be minted; nothing names it.
import node from '@prisma/composer/node';
import { compute } from '@prisma/composer-prisma-cloud';
import { durableStreams } from '@prisma/composer-prisma-cloud/streams';

export default compute({
  name: 'worker',
  deps: { streams: durableStreams() },
  build: node({ module: import.meta.url, entry: '../../dist/worker/server.mjs' }),
});
```

```ts
// src/worker/server.ts — append, then wait for what follows
import service from './service.ts';

const { streams } = service.load(); // StreamsClient, ready to call

await streams.create('jobs');
await streams.append('jobs', { kind: 'created' });
const { events, nextOffset } = await streams.read('jobs');
const next = await streams.tail('jobs'); // resolves on the next event (or timedOut)
```

For local development and tests, build the same client against the stand-in
(no deployed binding, no auth):

```ts
import { createStreamsClient } from '@prisma/composer-prisma-cloud/streams';

const client = createStreamsClient({ url: standIn.url, apiKey: 'unused' });
```

[`examples/streams`](../../../../examples/streams) is the worked example — the
module deployed to Prisma Cloud with `storage()` as its tier and a `jobs`
service consuming the binding, plus local integration tests and a deployed
consumer smoke script.

## Local development

`@prisma/composer-prisma-cloud/streams/testing` embeds the local stand-in
(`@prisma/streams-local`): SQLite-only, loopback, **no auth, no object store,
no cloud credentials** — the same protocol surface.

```ts
import { startLocalStreamsServer } from '@prisma/composer-prisma-cloud/streams/testing';

const server = await startLocalStreamsServer({ name: 'dev', port: 0 });
// server.exports.http.url is a Durable Streams endpoint (no Authorization needed).
// await server.close() when done.
```

The stand-in persists under `DS_LOCAL_DATA_ROOT`; tests point that at a
throwaway directory. The full conformance suite runs against it with no
credentials: `pnpm test:conformance:local` (and against a deployment:
`CONFORMANCE_TEST_URL=… STREAMS_API_KEY=… pnpm test:conformance:deployed`).

## Deployed live path: use long-poll

The Compute ingress currently buffers HTTP responses until the upstream
response completes. An open `?live=sse` tail therefore never delivers through
a deployment's public URL — the client sees zero bytes and the edge returns a
504 after ~60s — while the same request works locally and against the
stand-in. `?live=long-poll` completes per response and delivers live events
end to end through the ingress, so `StreamsClient.tail` long-polls. The
deployed conformance harness keeps the SSE tests, so they flip green when the
platform supports streaming responses.
