import { describe, expect, test } from "bun:test";
import { LoadError } from "../graph.ts";
import { resource, service } from "../node.ts";
import { ConfigError, runHost } from "../runtime/index.ts";
import { conn, testHost } from "./helpers.ts";

const dbNode = (record?: (cfg: Record<string, string>) => void) =>
  resource({
    type: "fake/db",
    connection: conn([{ name: "url", secret: true }], (cfg) => {
      record?.(cfg);
      return { client: cfg.url };
    }),
  });

describe("runHost", () => {
  test("resolves from env, hydrates each connection with its slice, builds the context", () => {
    let received: unknown;
    let ctx: unknown;
    const slices: Record<string, string>[] = [];
    const root = service({
      type: "fake/app",
      inputs: { db: dbNode((cfg) => slices.push(cfg)) },
      host: testHost,
      handler: (deps, c) => {
        received = deps;
        ctx = c;
        return "served";
      },
    });

    const result = runHost(root, { env: { DB_URL: "postgres://x", PORT: "8080" } });

    expect(result).toBe("served");
    expect(slices).toEqual([{ url: "postgres://x" }]);
    expect(received).toEqual({ db: { client: "postgres://x" } });
    expect(ctx).toEqual({ port: 8080 });
  });

  test("resolution precedence: override > env > default", () => {
    let ctx: { port?: number } = {};
    const slices: Record<string, string>[] = [];
    const root = service({
      type: "fake/app",
      inputs: { db: dbNode((cfg) => slices.push(cfg)) },
      host: testHost,
      handler: (_deps, c) => {
        ctx = c;
        return null;
      },
    });

    runHost(root, {
      env: { DB_URL: "postgres://from-env", PORT: "1111" },
      config: { "db.url": "postgres://override", "context.port": "2222" },
    });

    expect(slices).toEqual([{ url: "postgres://override" }]); // override beats env
    expect(ctx).toEqual({ port: 2222 });

    runHost(root, { env: { DB_URL: "postgres://from-env" } });
    expect(slices[1]).toEqual({ url: "postgres://from-env" }); // env beats default
    expect(ctx).toEqual({ port: 3000 }); // default when env has no PORT
  });

  test("field-level override boots with no env at all", () => {
    let received: unknown;
    const root = service({
      type: "fake/app",
      inputs: { db: dbNode() },
      host: testHost,
      handler: (deps) => {
        received = deps;
        return null;
      },
    });

    runHost(root, { env: {}, config: { "db.url": "postgres://test" } });

    expect(received).toEqual({ db: { client: "postgres://test" } });
  });

  test("ConfigError names EVERY missing required key at once, before any hydrate", () => {
    let hydrateCalls = 0;
    const root = service({
      type: "fake/app",
      inputs: {
        db: resource({
          type: "fake/db",
          connection: conn([{ name: "url" }], () => {
            hydrateCalls += 1;
            return {};
          }),
        }),
        cache: resource({
          type: "fake/cache",
          connection: conn([{ name: "url" }], () => {
            hydrateCalls += 1;
            return {};
          }),
        }),
      },
      host: testHost,
      handler: () => null,
    });

    expect(() => runHost(root, { env: {} })).toThrow(ConfigError);
    try {
      runHost(root, { env: {} });
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("DB_URL");
      expect(message).toContain("CACHE_URL");
      expect(message).toContain("db.url");
      expect(message).toContain("cache.url");
    }
    expect(hydrateCalls).toBe(0);
  });

  test("optional fields may be absent; the hydrate slice simply omits them", () => {
    const slices: Record<string, string>[] = [];
    const root = service({
      type: "fake/app",
      inputs: {
        db: resource({
          type: "fake/db",
          connection: conn(
            [{ name: "url" }, { name: "schema", optional: true }],
            (cfg) => {
              slices.push(cfg);
              return {};
            },
          ),
        }),
      },
      host: testHost,
      handler: () => null,
    });

    runHost(root, { env: { DB_URL: "postgres://x" } });

    expect(slices).toEqual([{ url: "postgres://x" }]);
  });

  test("a dep-less service boots with zero declared config", () => {
    let ctx: unknown;
    const root = service({
      type: "fake/app",
      inputs: {},
      host: testHost,
      handler: (_deps, c) => {
        ctx = c;
        return "booted";
      },
    });

    expect(runHost(root, { env: {} })).toBe("booted");
    expect(ctx).toEqual({ port: 3000 });
  });

  test("a non-numeric context value falls back to the declared default", () => {
    let ctx: unknown;
    const root = service({
      type: "fake/app",
      inputs: {},
      host: testHost,
      handler: (_deps, c) => {
        ctx = c;
        return null;
      },
    });

    runHost(root, { env: { PORT: "not-a-number" } });

    expect(ctx).toEqual({ port: 3000 });
  });

  test("Load runs first: a malformed graph fails with LoadError, nothing hydrates", () => {
    let hydrateCalls = 0;
    const root = service({
      type: "fake/app",
      inputs: { db: { not: "a node" } as never },
      host: testHost,
      handler: () => null,
    });

    expect(() =>
      runHost(root, { env: {}, config: { "db.url": "postgres://x" } }),
    ).toThrow(LoadError);
    expect(hydrateCalls).toBe(0);
  });

  test("does not call the handler when config validation fails", () => {
    let handlerCalls = 0;
    const root = service({
      type: "fake/app",
      inputs: { db: dbNode() },
      host: testHost,
      handler: () => {
        handlerCalls += 1;
        return null;
      },
    });

    expect(() => runHost(root, { env: {} })).toThrow(ConfigError);
    expect(handlerCalls).toBe(0);
  });
});
