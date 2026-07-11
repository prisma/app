/**
 * `pnPostgres()`'s runtime behavior — proven without a live database. The PN
 * client is lazy (its pool opens on first query), so hydrate is fully
 * exercisable here: `pnPostgresRuntime()` never connects just by being
 * constructed (see `fixtures/widget-contract/`'s round trip through the real
 * `prisma-next contract emit` CLI for the artifacts this suite imports).
 *
 * `pnContract<Contract>(contractJson)` pins the type parameter explicitly —
 * a JSON module import's inferred type is plain data, not the branded
 * `contract.d.ts` type, matching `@prisma-next/postgres/runtime`'s own
 * `postgres<Contract>({ contractJson })` convention (see prisma-next.ts).
 */
import { describe, expect, test } from 'bun:test';
import { isNode } from '@prisma/app';
import { pnContract, pnPostgres } from '../prisma-next.ts';
import type { Contract as WidgetContract } from './fixtures/widget-contract/emitted/contract.d.ts';
import widgetContractJson from './fixtures/widget-contract/emitted/contract.json' with { type: 'json' };
import type { Contract as GadgetContract } from './fixtures/gadget-contract/emitted/contract.d.ts';
import gadgetContractJson from './fixtures/gadget-contract/emitted/contract.json' with {
  type: 'json',
};

describe('pnContract().satisfies()', () => {
  test('true when the required contract has the same storageHash', () => {
    const a = pnContract<WidgetContract>(widgetContractJson);
    const b = pnContract<WidgetContract>(widgetContractJson);
    expect(a.satisfies(b)).toBe(true);
    expect(b.satisfies(a)).toBe(true);
  });

  test('false when the required contract has a different storageHash', () => {
    const widget = pnContract<WidgetContract>(widgetContractJson);
    const gadget = pnContract<GadgetContract>(gadgetContractJson);
    expect(widget.satisfies(gadget)).toBe(false);
    expect(gadget.satisfies(widget)).toBe(false);
  });

  test('the wrapped contract is frozen and carries the prisma-next kind', () => {
    const widget = pnContract<WidgetContract>(widgetContractJson);
    expect(widget.kind).toBe('prisma-next');
    expect(Object.isFrozen(widget)).toBe(true);
  });
});

describe('pnPostgres() factory shapes', () => {
  test('{ name, config } yields a branded ResourceNode providing config.contract', () => {
    const widget = pnContract<WidgetContract>(widgetContractJson);
    const node = pnPostgres({ name: 'database', config: { contract: widget } });

    expect(isNode(node)).toBe(true);
    expect(node.kind).toBe('resource');
    expect(node.name).toBe('database');
    expect(node.extension).toBe('@prisma/app-cloud');
    expect(node.type).toBe('prisma-next');
    expect(node.provides).toBe(widget);
  });

  test('config.connection is accepted and ignored — the framework injects the URL at hydrate', () => {
    const widget = pnContract<WidgetContract>(widgetContractJson);
    const node = pnPostgres({
      name: 'database',
      config: { contract: widget, connection: 'postgres://ignored' },
    });
    expect(node.provides).toBe(widget);
  });

  test('pnPostgres(contract) yields a branded DependencyEnd requiring that contract', () => {
    const widget = pnContract<WidgetContract>(widgetContractJson);
    const dep = pnPostgres(widget);

    expect(isNode(dep)).toBe(true);
    expect(dep.kind).toBe('dependency');
    expect(dep.type).toBe('prisma-next');
    expect(dep.required).toBe(widget);
    expect(Object.keys(dep.connection.params)).toEqual(['url']);
    expect(dep.connection.params['url']).toEqual({ type: 'string', secret: true });
  });
});

describe('hydrate — no live database required (lazy pool)', () => {
  test('constructs a Prisma Next client from a fake url without connecting', async () => {
    const widget = pnContract<WidgetContract>(widgetContractJson);
    const dep = pnPostgres(widget);

    const client = await dep.connection.hydrate({
      url: 'postgres://user:pass@localhost:5432/does-not-exist',
    });

    // The PostgresClient surface — constructed synchronously; nothing here
    // implies a connection was opened (pool.connect() only happens on first
    // query/`.runtime()`/`.connect()` call, none of which this test makes).
    expect(typeof client.sql).toBe('object');
    expect(typeof client.orm).toBe('object');
    expect(typeof client.connect).toBe('function');
    expect(typeof client.runtime).toBe('function');
    expect(typeof client.close).toBe('function');
  });

  test('a mismatched-marker verifyMarker setting never throws at construct time', () => {
    // verifyMarker only runs lazily on first query (see module doc comment);
    // this asserts hydrate itself — which sets `verifyMarker: 'onFirstUse'`
    // — never throws just by constructing the client, regardless of what a
    // live database's marker would say.
    const widget = pnContract<WidgetContract>(widgetContractJson);
    const dep = pnPostgres(widget);

    expect(() =>
      dep.connection.hydrate({ url: 'postgres://user:pass@localhost:5432/mismatched' }),
    ).not.toThrow();
  });
});
