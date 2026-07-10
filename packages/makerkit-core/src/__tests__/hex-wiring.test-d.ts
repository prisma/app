/**
 * The accept/reject matrix for resource wiring, checked on the real hex:
 * `HexBuilder.provision` wiring a ResourceRef into a consumer's ResourceEnd
 * slot, and the Deps constraint that admits declarations (ends, Dependables)
 * while keeping bare ResourceNodes out of a service's inputs. Typechecked only (the package's `typecheck` script) —
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

const dualPg = Object.freeze({
  ...pgNode,
  toDependency: () =>
    resourceEnd({
      name: 'db',
      type: 'fake/postgres',
      connection: conn({ url: { type: 'string', secret: true } }, (v) => ({ url: v.url })),
    }),
});

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

const dualConsumer = service({
  name: 'test-service',
  pack: 'test/pack',
  type: 'fake/compute',
  // A dual value (identity + Dependable) is a valid deps entry.
  inputs: { db: dualPg },
  params: {},
  build,
});

declare const h: HexBuilder;

const pgRef = h.provision('pg', pgNode);
const cacheRef = h.provision('cache', cacheNode);
const producerRef = h.provision('producer', producer);
// A dual value is provisionable — its identity half; the ref is typed.
const dualRef = h.provision('dual-pg', dualPg);

// ---- MUST compile ----
h.provision('c1', consumer, { db: pgRef });
// The dual's slot wires like the ResourceEnd it converts to — literal type kept.
h.provision('c1b', dualConsumer, { db: dualRef });
h.provision('c1c', dualConsumer, { db: pgRef });

// ---- MUST be rejected ----
// @ts-expect-error a ResourceRef of another resource type cannot fill the slot
h.provision('c2', consumer, { db: cacheRef });
// @ts-expect-error a provisioned service's ref is not a ResourceRef
h.provision('c3', consumer, { db: producerRef });
// @ts-expect-error a wrong-type ResourceRef cannot fill the dual's slot either
h.provision('c3b', dualConsumer, { db: cacheRef });
// @ts-expect-error a dependency-only end (no identity) is not provisionable
h.provision('c3c', pgEnd);

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
