import { describe, expect, test } from "bun:test";
import { configOf } from "../config.ts";
import { connectionEnd, resource, service } from "../node.ts";
import { conn } from "./helpers.ts";

describe('configOf', () => {
  test('enumerates input params then service params — semantic, no platform keys', () => {
    const root = service({
      type: 'fake/app',
      inputs: {
        db: resource({
          type: 'fake/db',
          connection: conn(
            { url: { type: 'string', secret: true }, schema: { type: 'string', optional: true } },
            () => ({}),
          ),
        }),
      },
      params: { port: { type: "number", default: 3000 } },
      handler: () => null,
    });

    expect(configOf(root)).toEqual([
      { owner: { input: 'db' }, name: 'url', type: 'string', secret: true, optional: false },
      { owner: { input: 'db' }, name: 'schema', type: 'string', secret: false, optional: true },
      {
        owner: 'service',
        name: 'port',
        type: 'number',
        secret: false,
        optional: false,
        default: 3000,
      },
    ]);
  });

  test('owner discriminates service vs input params — same name cannot collide', () => {
    const root = service({
      type: 'fake/app',
      inputs: {
        cache: resource({
          type: 'fake/cache',
          connection: conn({ port: { type: 'number' } }, () => ({})),
        }),
      },
      params: { port: { type: "number", default: 3000 } },
      handler: () => null,
    });

    const owners = configOf(root).map((e) => ({ owner: e.owner, name: e.name }));
    expect(owners).toEqual([
      { owner: { input: 'cache' }, name: 'port' },
      { owner: 'service', name: 'port' },
    ]);
  });

  test('a dep-less service enumerates only its own params', () => {
    const root = service({
      type: 'fake/app',
      inputs: {},
      params: { port: { type: "number", default: 3000 } },
      handler: () => null,
    });

    expect(configOf(root)).toEqual([
      {
        owner: 'service',
        name: 'port',
        type: 'number',
        secret: false,
        optional: false,
        default: 3000,
      },
    ]);
  });

  test("executes nothing — no handler, no hydrate", () => {
    let handlerCalls = 0;
    let hydrateCalls = 0;
    const root = service({
      type: 'fake/app',
      inputs: {
        db: resource({
          type: 'fake/db',
          connection: conn({ url: { type: 'string' } }, () => {
            hydrateCalls += 1;
            return {};
          }),
        }),
      },
      params: {},
      handler: () => {
        handlerCalls += 1;
        return null;
      },
    });

    configOf(root);

    expect(handlerCalls).toBe(0);
    expect(hydrateCalls).toBe(0);
  });
});

describe("configOf over connection-end inputs", () => {
  test("connection-end params appear with owner { input } exactly like resource params", () => {
    const root = service({
      type: "fake/app",
      inputs: {
        db: resource({
          type: "fake/db",
          connection: conn({ url: { type: "string", secret: true } }, () => ({})),
        }),
        auth: connectionEnd({
          type: "fake/http",
          connection: conn({ url: { type: "string" } }, () => ({})),
        }),
      },
      params: { port: { type: "number", default: 3000 } },
      handler: () => null,
    });

    expect(configOf(root)).toEqual([
      { owner: { input: "db" }, name: "url", type: "string", secret: true, optional: false },
      { owner: { input: "auth" }, name: "url", type: "string", secret: false, optional: false },
      { owner: "service", name: "port", type: "number", secret: false, optional: false, default: 3000 },
    ]);
  });
});
