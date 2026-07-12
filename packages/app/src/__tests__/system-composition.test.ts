/**
 * The system boundary (ADR-0016): `deps`/`expose` on `system()`, forwarding through
 * the body, `provision()` accepting a system, and Load's boundary validation
 * errors plus recursive flattening into hierarchical addresses. `system.test.ts`
 * covers the pre-boundary Load mechanics (still exercised by an
 * empty-boundary system); this file covers what the boundary adds on top.
 */
import { describe, expect, test } from 'bun:test';
import { string } from '../config.ts';
import type { Contract } from '../contract.ts';
import { Load, LoadError } from '../graph.ts';
import type { ProvisionedRef } from '../node.ts';
import { dependency, resource, service, system } from '../node.ts';
import { conn, providerContract } from './helpers.ts';

const build = {
  extension: '@prisma/app-node',
  type: 'node',
  module: 'file:///test/service.ts',
  entry: 'server.js',
};

// A minimal Contract, nominal like @prisma/app-rpc's own: satisfies() is
// identity, so a ref-port only satisfies the contract it was actually built
// from — mirrors what a cast-bypassed wrong wiring would look like at
// runtime (see system.test.ts's own copy of this pattern).
const fakeContract = <Cmp>(cmp: Cmp): Contract<'rpc', Cmp> => {
  const value: Contract<'rpc', Cmp> = {
    kind: 'rpc',
    __cmp: cmp,
    satisfies: (required) => value === required,
  };
  return value;
};

const untypedEnd = () =>
  dependency({
    type: 'fake/http',
    connection: conn({ url: string() }, (v) => ({ url: v.url })),
  });

const noOpService = () =>
  service({
    name: 'noop',
    extension: 'test/pack',
    type: 'fake/compute',
    inputs: {},
    params: {},
    build,
  });

describe('a system with a declared dep that is never forwarded (Load error a)', () => {
  test('names the system and the input, and points at the fix', () => {
    const brokenAuthSystem = () =>
      system('auth', { deps: { db: untypedEnd() } }, ({ provision }) => {
        provision(noOpService(), { id: 'api' }); // never uses ctx.inputs.db
        return {};
      });

    const root = system('shop', {}, ({ provision }) => {
      const dbRef = provision(noOpService(), { id: 'dbProvider' });
      provision(brokenAuthSystem(), { id: 'auth', deps: { db: dbRef } });
      return {};
    });

    expect(() => Load(root)).toThrow(LoadError);
    expect(() => Load(root)).toThrow(
      'System "auth" declares input "db" but never forwards it into a provision nor returns it as an output.',
    );
  });

  test('aliasing regression: ONE producer wired into TWO inputs — forwarding one must not mark the other', () => {
    const consumer = () =>
      service({
        name: 'consumer',
        extension: 'test/pack',
        type: 'fake/compute',
        inputs: { in: untypedEnd() },
        params: {},
        build,
      });

    const aliasedSystem = () =>
      system('aliased', { deps: { a: untypedEnd(), b: untypedEnd() } }, ({ inputs, provision }) => {
        provision(consumer(), { id: 'c', deps: { in: inputs.a } }); // only "a" forwarded; "b" ignored
        return {};
      });

    const root = system('shop', {}, ({ provision }) => {
      const p = provision(noOpService(), { id: 'p' });
      // The SAME ref wired into both inputs — without per-key ctx.inputs
      // identities, the two entries alias and forwarding "a" falsely marks "b".
      provision(aliasedSystem(), { id: 'x', deps: { a: p, b: p } });
      return {};
    });

    expect(() => Load(root)).toThrow(LoadError);
    expect(() => Load(root)).toThrow(
      'System "aliased" declares input "b" but never forwards it into a provision nor returns it as an output.',
    );
  });

  test('distinct-producer control: both inputs forwarded — Loads clean, edges carry each real producer', () => {
    const consumer = () =>
      service({
        name: 'consumer',
        extension: 'test/pack',
        type: 'fake/compute',
        inputs: { one: untypedEnd(), two: untypedEnd() },
        params: {},
        build,
      });

    const wiredSystem = () =>
      system('wired', { deps: { a: untypedEnd(), b: untypedEnd() } }, ({ inputs, provision }) => {
        provision(consumer(), { id: 'c', deps: { one: inputs.a, two: inputs.b } });
        return {};
      });

    const root = system('shop', {}, ({ provision }) => {
      const p1 = provision(noOpService(), { id: 'p1' });
      const p2 = provision(noOpService(), { id: 'p2' });
      provision(wiredSystem(), { id: 'x', deps: { a: p1, b: p2 } });
      return {};
    });

    const graph = Load(root);

    expect(graph.edges).toContainEqual({ from: 'p1', to: 'x.c', input: 'one', kind: 'dependency' });
    expect(graph.edges).toContainEqual({ from: 'p2', to: 'x.c', input: 'two', kind: 'dependency' });
  });
});

describe('a system expose key missing from the body return or failing satisfies (Load error b)', () => {
  const authContract = fakeContract({ verify: async () => ({ ok: true }) });
  const wrongContract = fakeContract({ charge: async () => ({ id: '1' }) });

  const contractProvider = <C extends Contract<'rpc', unknown>>(exposed: C) =>
    service({
      name: 'provider',
      extension: 'test/pack',
      type: 'fake/compute',
      inputs: {},
      params: {},
      build,
      expose: { rpc: exposed },
    });

  test('a missing return for the declared key names the system and the key', () => {
    const missingExposeSystem = system(
      'auth',
      { expose: { verify: authContract } },
      ({ provision }) => {
        provision(contractProvider(authContract), { id: 'api' });
        return {} as never; // the declared "verify" key is never returned
      },
    );

    expect(() => Load(missingExposeSystem)).toThrow(LoadError);
    expect(() => Load(missingExposeSystem)).toThrow(
      'System "auth" declares expose "verify" but its body did not return a port for it.',
    );
  });

  test('a returned port that fails satisfies() names the system and the key', () => {
    const wrongExposeSystem = system(
      'auth',
      { expose: { verify: authContract } },
      ({ provision }) => {
        const ref = contractProvider(wrongContract);
        const provided = provision(ref, { id: 'api' });
        // TypeScript already rejects this at the return-type check; this
        // exercises the runtime backstop, as if that check were bypassed.
        return { verify: provided.rpc as never };
      },
    );

    expect(() => Load(wrongExposeSystem)).toThrow(LoadError);
    expect(() => Load(wrongExposeSystem)).toThrow(
      `System "auth"'s returned port for expose "verify" does not satisfy its declared contract.`,
    );
  });
});

describe('a system with non-empty deps Loaded as root (Load error c)', () => {
  test('names the system and the input(s), pointing at the composing system', () => {
    const rootWithDeps = system('auth', { deps: { db: untypedEnd() } }, ({ provision }) => {
      provision(noOpService(), { id: 'api' });
      return {};
    });

    expect(() => Load(rootWithDeps)).toThrow(LoadError);
    expect(() => Load(rootWithDeps)).toThrow(
      'System "auth" declares input "db" but is being deployed as the root — a root has no enclosing ' +
        'scope to wire them; compose "auth" from another system that provisions and wires it instead.',
    );
  });

  test('pluralizes and lists every declared input when there is more than one', () => {
    const rootWithDeps = system(
      'auth',
      { deps: { db: untypedEnd(), cache: untypedEnd() } },
      ({ provision }) => {
        provision(noOpService(), { id: 'api' });
        return {};
      },
    );

    expect(() => Load(rootWithDeps)).toThrow(/declares inputs "db", "cache" but is being deployed/);
  });
});

describe('a forwarding cycle through a system boundary (Load error d)', () => {
  const peerService = () =>
    service({
      name: 'peer-svc',
      extension: 'test/pack',
      type: 'fake/compute',
      inputs: { peer: untypedEnd() },
      params: {},
      build,
    });

  test('the DAG check sees through the boundary — the cycle is named by full address', () => {
    // 'sub' honestly forwards its declared "peer" input into its own child
    // ("inner") — an ordinary down-forward, no forging needed for that half.
    const subSystem = () =>
      system('sub', { deps: { peer: untypedEnd() } }, ({ inputs, provision }) => {
        provision(peerService(), { id: 'inner', deps: { peer: inputs.peer } });
        return {};
      });

    const root = system('shop', {}, ({ provision }) => {
      // The only forgery: 'a' names "sub.inner" — a full hierarchical
      // address — before "sub" (let alone "sub.inner") is provisioned. An
      // honest body cannot express this forward reference (refs are only
      // returned after provision()); the DAG check is what catches it.
      const forged = { id: 'sub.inner' } as ProvisionedRef;
      const aRef = provision(peerService(), { id: 'a', deps: { peer: forged } });
      provision(subSystem(), { id: 'sub', deps: { peer: aRef } }); // a → sub.inner (honest forward)
      return {};
    });

    expect(() => Load(root)).toThrow(LoadError);
    expect(() => Load(root)).toThrow(/Dependency cycle/);
    try {
      Load(root);
      throw new Error('expected Load to throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('a');
      expect(message).toContain('sub.inner');
    }
  });
});

describe('3-level nesting: addresses, and forwarding down + up round trip', () => {
  const cfgContract = fakeContract({ get: async () => 'v' });
  const outContract = fakeContract({ ping: async () => 'pong' });

  const cfgEnd = () =>
    dependency({
      type: 'fake/rpc-cfg',
      connection: conn({ url: string() }, (v) => ({ url: v.url })),
      required: cfgContract,
    });

  const outEnd = () =>
    dependency({
      type: 'fake/rpc-out',
      connection: conn({ url: string() }, (v) => ({ url: v.url })),
      required: outContract,
    });

  const configService = () =>
    service({
      name: 'config',
      extension: 'test/pack',
      type: 'fake/compute',
      inputs: {},
      params: {},
      build,
      expose: { cfg: cfgContract },
    });

  const leafService = () =>
    service({
      name: 'leaf',
      extension: 'test/pack',
      type: 'fake/compute',
      inputs: { cfg: cfgEnd() },
      params: {},
      build,
      expose: { out: outContract },
    });

  const sinkService = () =>
    service({
      name: 'sink',
      extension: 'test/pack',
      type: 'fake/compute',
      inputs: { out: outEnd() },
      params: {},
      build,
    });

  // inner (depth 2) forwards its "cfg" input down into "leaf", and forwards
  // leaf's "out" port up as its own expose.
  const innerSystem = () =>
    system(
      'inner',
      { deps: { cfg: cfgEnd() }, expose: { out: outContract } },
      ({ inputs, provision }) => {
        const leaf = provision(leafService(), { id: 'leaf', deps: { cfg: inputs.cfg } });
        return { out: leaf.out };
      },
    );

  // mid (depth 1) does the same one level up — a pure pass-through of both
  // directions, proving forwarding composes across more than one boundary.
  const midSystem = () =>
    system(
      'mid',
      { deps: { cfg: cfgEnd() }, expose: { out: outContract } },
      ({ inputs, provision }) => {
        const inner = provision(innerSystem(), { id: 'inner', deps: { cfg: inputs.cfg } });
        return { out: inner.out };
      },
    );

  const rootSystem = () =>
    system('app', {}, ({ provision }) => {
      const cfg = provision(configService(), { id: 'config' });
      const mid = provision(midSystem(), { id: 'mid', deps: { cfg: cfg.cfg } });
      provision(sinkService(), { id: 'sink', deps: { out: mid.out } });
      return {};
    });

  test('flattens 3 levels deep with hierarchical, dot-joined addresses', () => {
    const graph = Load(rootSystem(), { id: 'app' });

    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain('config');
    expect(ids).toContain('mid');
    expect(ids).toContain('mid.inner');
    expect(ids).toContain('mid.inner.leaf');
    expect(ids).toContain('mid.inner.leaf.cfg');
    expect(ids).toContain('sink');
    expect(ids).toContain('sink.out');
    expect(ids).toContain('app');

    const kindOf = (id: string) => graph.nodes.find((n) => n.id === id)?.node.kind;
    expect(kindOf('mid')).toBe('system');
    expect(kindOf('mid.inner')).toBe('system');
    expect(kindOf('mid.inner.leaf')).toBe('service');
  });

  test('an input forwarded down 2 levels resolves to the real (top-level) producer', () => {
    const graph = Load(rootSystem());

    expect(graph.edges).toContainEqual({
      from: 'config',
      to: 'mid.inner.leaf',
      input: 'cfg',
      kind: 'dependency',
    });
  });

  test('an output forwarded up 2 levels resolves to the real (deepest) producer', () => {
    const graph = Load(rootSystem());

    expect(graph.edges).toContainEqual({
      from: 'mid.inner.leaf',
      to: 'sink',
      input: 'out',
      kind: 'dependency',
    });
  });

  test('a single-level system keeps bare, unprefixed ids — nesting changes nothing about the flat case', () => {
    const flat = system('shop', {}, ({ provision }) => {
      provision(configService(), { id: 'config' });
      return {};
    });

    const graph = Load(flat);

    expect(graph.nodes.map((n) => n.id)).toEqual(['config', 'shop']);
  });
});

describe('pass-through: an expose may return a boundary input directly', () => {
  const rpcContract = fakeContract({ call: async () => 'ok' });

  const rpcEnd = () =>
    dependency({
      type: 'fake/rpc',
      connection: conn({ url: string() }, (v) => ({ url: v.url })),
      required: rpcContract,
    });

  const rpcProvider = () =>
    service({
      name: 'provider',
      extension: 'test/pack',
      type: 'fake/compute',
      inputs: {},
      params: {},
      build,
      expose: { rpc: rpcContract },
    });

  const rpcConsumer = () =>
    service({
      name: 'sink',
      extension: 'test/pack',
      type: 'fake/compute',
      inputs: { svc: rpcEnd() },
      params: {},
      build,
    });

  // The system provisions NOTHING with its input — it only re-offers it as its
  // own output. Re-offering is using, not ignoring (rule a).
  const passSystem = () =>
    system('pass', { deps: { svc: rpcEnd() }, expose: { svc: rpcContract } }, ({ inputs }) => ({
      svc: inputs.svc,
    }));

  test('Loads clean — returning an input as an output counts as using it', () => {
    const root = system('shop', {}, ({ provision }) => {
      const origin = provision(rpcProvider(), { id: 'origin' });
      const pass = provision(passSystem(), { id: 'pass', deps: { svc: origin.rpc } });
      provision(rpcConsumer(), { id: 'sink', deps: { svc: pass.svc } });
      return {};
    });

    expect(() => Load(root)).not.toThrow();
  });

  test("a consumer wired to the pass-through output resolves to the ORIGINAL producer's real address", () => {
    const root = system('shop', {}, ({ provision }) => {
      const origin = provision(rpcProvider(), { id: 'origin' });
      const pass = provision(passSystem(), { id: 'pass', deps: { svc: origin.rpc } });
      provision(rpcConsumer(), { id: 'sink', deps: { svc: pass.svc } });
      return {};
    });

    const graph = Load(root);

    // Not "pass" — the system is transparent; the edge goes straight to origin.
    expect(graph.edges).toContainEqual({
      from: 'origin',
      to: 'sink',
      input: 'svc',
      kind: 'dependency',
    });
  });
});

describe('untyped inputs (http() escape hatch) forward with no compile-time check', () => {
  const someContract = fakeContract({ a: async () => 1 });
  const otherContract = fakeContract({ b: async () => 2 });

  test("Load's satisfies() backstop still catches a contract mismatch at the consumer", () => {
    const provider = service({
      name: 'provider',
      extension: 'test/pack',
      type: 'fake/compute',
      inputs: {},
      params: {},
      build,
      expose: { port: otherContract },
    });
    const typedConsumer = service({
      name: 'sink',
      extension: 'test/pack',
      type: 'fake/compute',
      inputs: {
        svc: dependency({
          type: 'fake/rpc',
          connection: conn({ url: string() }, (v) => ({ url: v.url })),
          required: someContract,
        }),
      },
      params: {},
      build,
    });

    // The system's own input is UNTYPED — forwarding it compiles with no
    // contract check (InputRef<untyped> is `never`); the typed consumer's
    // required contract is only enforced by Load.
    const relaySystem = () =>
      system('relay', { deps: { anything: untypedEnd() } }, ({ inputs, provision }) => {
        provision(typedConsumer, { id: 'sink', deps: { svc: inputs.anything } });
        return {};
      });

    const root = system('shop', {}, ({ provision }) => {
      const p = provision(provider, { id: 'p' });
      provision(relaySystem(), { id: 'relay', deps: { anything: p.port } }); // wrong contract flows in
      return {};
    });

    expect(() => Load(root)).toThrow(LoadError);
    expect(() => Load(root)).toThrow(
      'The deps for "relay.sink.svc" do not satisfy the slot\'s required contract.',
    );
  });
});

describe('a resource-backed input now forwards across a system boundary (unified model)', () => {
  // Under the old (pre-unification) model a ResourceEnd carried a resource
  // TYPE (a string literal), never a Contract, so InputRef mapped it to
  // `never` — a resource-backed system input could not forward at all. In the
  // unified model every dependency slot — resource-backed or service-backed
  // — carries a Contract via `required`, so InputRef yields a real RefPort
  // for it too, and forwarding works exactly like a service-backed input.
  const dbContract = providerContract('fake/db', { url: '' });

  const dbDep = () =>
    dependency({
      name: 'db',
      type: 'fake/db',
      connection: conn({ url: string({ secret: true }) }, (v) => ({ url: v.url })),
      required: dbContract,
    });

  const dbConsumer = () =>
    service({
      name: 'consumer',
      extension: 'test/pack',
      type: 'fake/compute',
      inputs: { db: dbDep() },
      params: {},
      build,
    });

  const dbSystem = () =>
    system('db-system', { deps: { db: dbDep() } }, ({ inputs, provision }) => {
      provision(dbConsumer(), { id: 'consumer', deps: { db: inputs.db } });
      return {};
    });

  const rootWithResource = () =>
    system('shop', {}, ({ provision }) => {
      const db = provision(resource({ name: 'db', extension: 'test/pack', provides: dbContract }), {
        id: 'db',
      });
      provision(dbSystem(), { id: 'wrapped', deps: { db } });
      return {};
    });

  test('Loads clean — a system-provisioned resource forwards through the boundary into the nested consumer', () => {
    expect(() => Load(rootWithResource())).not.toThrow();
  });

  test('the edge resolves straight to the resource — the wrapping system is transparent', () => {
    const graph = Load(rootWithResource());

    expect(graph.edges).toContainEqual({
      from: 'db',
      to: 'wrapped.consumer',
      input: 'db',
      kind: 'dependency',
    });
  });
});

describe('provision ids may not contain "." (the address separator)', () => {
  test('a dotted id is a LoadError naming the reserved characters', () => {
    const root = system('shop', {}, ({ provision }) => {
      provision(noOpService(), { id: 'a.b' });
      return {};
    });

    expect(() => Load(root)).toThrow(LoadError);
    expect(() => Load(root)).toThrow(
      'provision() id "a.b" (system "shop") may not contain "_" or "." — "_" is the config-key ' +
        'separator and "." the node-id path separator',
    );
  });
});

describe('provision() with an inferred id (the id-less overloads)', () => {
  const rpcContract = providerContract('fake/rpc', { work: true });

  const producer = () =>
    service({
      name: 'worker',
      extension: 'test/pack',
      type: 'fake/compute',
      inputs: {},
      params: {},
      build,
      expose: { rpc: rpcContract },
    });

  const consumer = () =>
    service({
      name: 'consumer',
      extension: 'test/pack',
      type: 'fake/compute',
      inputs: {
        dep: dependency({
          name: 'dep',
          type: 'fake/rpc',
          connection: conn({ url: string() }, (v) => ({ url: v.url })),
          required: rpcContract,
        }),
      },
      params: {},
      build,
    });

  test('provision(node) infers the id from node.name and Loads the same graph as provision(node.name, node)', () => {
    const inferred = system('shop', {}, ({ provision }) => {
      provision(producer());
      return {};
    });
    const explicit = system('shop', {}, ({ provision }) => {
      provision(producer(), { id: 'worker' });
      return {};
    });

    const inferredIds = Load(inferred)
      .nodes.map((n) => n.id)
      .sort();
    const explicitIds = Load(explicit)
      .nodes.map((n) => n.id)
      .sort();

    expect(inferredIds).toEqual(explicitIds);
    expect(inferredIds).toContain('worker');
  });

  test('provision(node, wiring) infers the id and wires each producer ref', () => {
    const root = system('shop', {}, ({ provision }) => {
      const w = provision(producer());
      provision(consumer(), { deps: { dep: w.rpc } });
      return {};
    });

    const graph = Load(root);

    expect(graph.nodes.map((n) => n.id)).toContain('consumer');
    expect(graph.edges).toContainEqual({
      from: 'worker',
      to: 'consumer',
      input: 'dep',
      kind: 'dependency',
    });
  });

  test('two same-named nodes provisioned by inference raise the existing Duplicate provision id error', () => {
    const root = system('shop', {}, ({ provision }) => {
      provision(producer());
      provision(producer());
      return {};
    });

    expect(() => Load(root)).toThrow(LoadError);
    expect(() => Load(root)).toThrow('Duplicate provision id "worker" in system "shop".');
  });

  test('provision(resource) infers the id from the resource name', () => {
    const dbResource = resource({
      name: 'db',
      extension: 'test/pack',
      provides: providerContract('fake/db', { url: '' }),
    });
    const root = system('shop', {}, ({ provision }) => {
      provision(dbResource);
      return {};
    });

    expect(Load(root).nodes.map((n) => n.id)).toContain('db');
  });

  test('provision(childSystem) infers the id and still flattens nested addresses', () => {
    const child = system('child', {}, ({ provision }) => {
      provision(producer());
      return {};
    });
    const root = system('shop', {}, ({ provision }) => {
      provision(child);
      return {};
    });

    const ids = Load(root).nodes.map((n) => n.id);
    expect(ids).toContain('child');
    expect(ids).toContain('child.worker');
  });
});
