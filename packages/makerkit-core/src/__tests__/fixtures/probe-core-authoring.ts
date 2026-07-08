// Bundle probe for the import-split guard: uses core's authoring entry the way
// a user service module would, with real value usage so nothing tree-shakes away.
import { configOf, connectionEnd, hex, hydrate, Load, resource, service } from '../../index.ts';

const db = resource({
  type: 'probe/db',
  connection: {
    params: { url: { type: 'string', secret: true } },
    hydrate: (v) => ({ url: v.url }),
  },
});

const app = service({
  type: 'probe/app',
  inputs: { db },
  params: { port: { type: 'number', default: 3000 } },
  build: { kind: 'node', entry: 'server.js' },
});

const peer = connectionEnd({
  type: 'probe/http',
  connection: { params: { url: { type: 'string' } }, hydrate: (v) => ({ url: v.url }) },
});

const caller = service({
  type: 'probe/app',
  inputs: { peer },
  params: {},
  build: { kind: 'node', entry: 'server.js' },
});

export const wired = Load(
  hex('probe-hex', (h) => {
    const ref = h.provision('app', app);
    h.provision('caller', caller, { peer: ref });
  }),
);

export const graph = Load(app, { id: 'probe' });
export const declarations = configOf(app);
export const hydrated = hydrate(app, { service: { port: 3000 }, inputs: { db: { url: 'x' } } });
