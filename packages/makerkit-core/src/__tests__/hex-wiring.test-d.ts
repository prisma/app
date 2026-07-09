/**
 * The accept/reject matrix for resource wiring, checked on the real hex:
 * `HexBuilder.provision` wiring a ResourceRef into a consumer's ResourceEnd
 * slot, and the Deps constraint that keeps concrete ResourceNodes out of a
 * service's inputs. Typechecked only (the package's `typecheck` script) —
 * never executed: the reject cases are exactly what Load's runtime backstop
 * throws on (see hex.test.ts), so running this file would throw. `.test-d`
 * (not `.test`) keeps it out of `bun test`.
 */
import type { BuildAdapter, HexBuilder } from '../node.ts';
import { resource, resourceEnd, service } from '../node.ts';
import { conn } from './helpers.ts';

const build: BuildAdapter = {
  kind: 'node',
  pack: '@makerkit/node',
  module: 'file:///test/service.ts',
  entry: 'server.js',
};

const pgNode = resource({ name: 'db', pack: 'test/pack', type: 'fake/postgres' });
const cacheNode = resource({ name: 'cache', pack: 'test/pack', type: 'fake/cache' });

const pgEnd = resourceEnd({
  name: 'db',
  type: 'fake/postgres',
  connection: conn({ url: { type: 'string', secret: true } }, (v) => ({ url: v.url })),
});

const consumer = service({
  name: 'test-service',
  pack: 'test/pack',
  type: 'fake/compute',
  inputs: { db: pgEnd },
  params: {},
  build,
});

const producer = service({
  name: 'test-service',
  pack: 'test/pack',
  type: 'fake/compute',
  inputs: {},
  params: {},
  build,
});

declare const h: HexBuilder;

const pgRef = h.provision('pg', pgNode);
const cacheRef = h.provision('cache', cacheNode);
const producerRef = h.provision('producer', producer);

// ---- MUST compile ----
h.provision('c1', consumer, { db: pgRef });

// ---- MUST be rejected ----
// @ts-expect-error a ResourceRef of another resource type cannot fill the slot
h.provision('c2', consumer, { db: cacheRef });
// @ts-expect-error a provisioned service's ref is not a ResourceRef
h.provision('c3', consumer, { db: producerRef });

// A concrete ResourceNode can never sit in deps — only declarations (ends).
service({
  name: 'test-service',
  pack: 'test/pack',
  type: 'fake/compute',
  // @ts-expect-error a ResourceNode is not a dependency declaration
  inputs: { db: pgNode },
  params: {},
  build,
});
