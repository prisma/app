import { describe, expect, test } from "bun:test";
import { configOf, isNode } from "@makerkit/core";
import { configKey, deserialize } from "../codec.ts";
import { compute, postgres } from "../index.ts";

/** Sets env vars for the duration of `fn`, restoring whatever was there before. */
async function withEnv<T>(values: Record<string, string>, fn: () => Promise<T> | T): Promise<T> {
  const previous = new Map(Object.keys(values).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) process.env[k] = v;
  try {
    return await fn();
  } finally {
    for (const [k, v] of previous) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('postgres({ client })', () => {
  test('returns a branded resource node declaring { url: string, secret }', () => {
    const node = postgres({ client: ({ url }) => ({ url }) });

    expect(isNode(node)).toBe(true);
    expect(node.kind).toBe('resource');
    expect(node.type).toBe('prisma-cloud/postgres');
    expect(node.connection.params).toEqual({ url: { type: 'string', secret: true } });
  });

  test("hydrate delegates to the app's client factory; C is inferred", async () => {
    const made: unknown[] = [];
    const node = postgres({
      client: (config) => {
        made.push(config);
        return { fake: 'client', ...config };
      },
    });

    const client = await node.connection.hydrate({ url: 'postgres://u:p@host:5432/db' });

    expect(made).toEqual([{ url: 'postgres://u:p@host:5432/db' }]);
    expect(client).toEqual({ fake: 'client', url: 'postgres://u:p@host:5432/db' });
  });
});

describe("compute()", () => {
  test("returns a branded, runnable service node declaring { port: number, default 3000 }", () => {
    const node = compute({}, () => null);

    expect(isNode(node)).toBe(true);
    expect(node.kind).toBe("service");
    expect(node.type).toBe("prisma-cloud/compute");
    expect(node.params).toEqual({ port: { type: "number", default: 3000 } });
    expect(typeof node.run).toBe("function");
  });

  test("is inert until invoked or run", () => {
    let calls = 0;
    const db = postgres({ client: ({ url }) => ({ url }) });
    const node = compute({ db }, () => {
      calls += 1;
      return null;
    });

    expect(node.inputs.db).toBe(db);
    expect(calls).toBe(0);
  });

  test("the DI test path: node.invoke(fakes, ctx) needs no environment", () => {
    let received: unknown;
    const node = compute({ db: postgres({ client: ({ url }) => ({ url }) }) }, (deps) => {
      received = deps;
      return "served";
    });

    const result = node.invoke({ db: { url: "postgres://fake" } }, { port: 0 });

    expect(result).toBe("served");
    expect(received).toEqual({ db: { url: "postgres://fake" } });
  });
});

describe("the config codec (shared by run() and /target's serialize)", () => {
  test("configKey: lone-service root (address '') is unprefixed — owner ▸ name", () => {
    const app = compute({ db: postgres({ client: ({ url }) => ({ url }) }) }, () => null);
    const [dbUrl, port] = configOf(app);

    expect(configKey("", dbUrl)).toBe("DB_URL");
    expect(configKey("", port)).toBe("PORT");
  });

  test("configKey: a hex-addressed service prefixes with its address segment", () => {
    const app = compute({ db: postgres({ client: ({ url }) => ({ url }) }) }, () => null);
    const [dbUrl] = configOf(app);

    expect(configKey("auth", dbUrl)).toBe("AUTH_DB_URL");
  });

  test("configKey: a connection-end input keys the same way as a resource input", () => {
    const app = compute({}, () => null);
    // A synthetic declaration shaped like configOf would produce for a
    // connection-end input named "auth".
    const decl = { owner: { input: "auth" }, name: "url", type: "string" as const, secret: false, optional: false };

    expect(configKey("storefront", decl)).toBe("STOREFRONT_AUTH_URL");
    void app;
  });

  test("deserialize round-trips what a service declares, reading process.env by configKey", async () => {
    const app = compute({ db: postgres({ client: ({ url }) => ({ url }) }) }, () => null);
    const shape = configOf(app);

    await withEnv({ DB_URL: "postgres://x", PORT: "4001" }, () => {
      const config = deserialize(shape, "");
      expect(config).toEqual({ service: { port: 4001 }, inputs: { db: { url: "postgres://x" } } });
    });
  });

  test("deserialize: an unset param with a default resolves to the default", async () => {
    const app = compute({}, () => null);
    const shape = configOf(app);

    await withEnv({}, () => {
      expect(deserialize(shape, "")).toEqual({ service: { port: 3000 }, inputs: {} });
    });
  });

  test("deserialize: a missing required param fails loudly, naming the param", async () => {
    const app = compute({ db: postgres({ client: ({ url }) => ({ url }) }) }, () => null);
    const shape = configOf(app);

    await withEnv({}, () => {
      expect(() => deserialize(shape, "")).toThrow(/db\.url|"url"/);
    });
  });

  test("deserialize: an invalid number fails loudly even with a default present", async () => {
    const app = compute({}, () => null);
    const shape = configOf(app);

    await withEnv({ PORT: "not-a-number" }, () => {
      expect(() => deserialize(shape, "")).toThrow(/port/);
    });
  });
});

describe("compute().run(address) — the whole boot loop", () => {
  test("deserializes env by address, hydrates, and invokes the handler", async () => {
    let received: unknown;
    let ctx: unknown;
    const app = compute({ db: postgres({ client: ({ url }) => ({ url }) }) }, (deps, c) => {
      received = deps;
      ctx = c;
      return "served";
    });

    const result = await withEnv({ AUTH_DB_URL: "postgres://x", AUTH_PORT: "4001" }, () => app.run("auth"));

    expect(result).toBe("served");
    expect(received).toEqual({ db: { url: "postgres://x" } });
    expect(ctx).toEqual({ port: 4001 });
  });

  test("a lone-service deploy (address '') reads unprefixed keys", async () => {
    let received: unknown;
    const app = compute({ db: postgres({ client: ({ url }) => ({ url }) }) }, (deps) => {
      received = deps;
      return null;
    });

    await withEnv({ DB_URL: "postgres://y" }, () => app.run(""));

    expect(received).toEqual({ db: { url: "postgres://y" } });
  });
});

describe('the config pipeline over pack nodes', () => {
  test('configOf is semantic — owner/name/type/secret, no platform keys', () => {
    const app = compute({ db: postgres({ client: ({ url }) => ({ url }) }) }, () => null);

    expect(configOf(app)).toEqual([
      { owner: { input: 'db' }, name: 'url', type: 'string', secret: true, optional: false },
      {
        owner: 'service',
        name: 'port',
        type: 'number',
        secret: false,
        optional: false,
        default: 3000,
      },
    ]);
    expect(JSON.stringify(configOf(app))).not.toContain('DATABASE_URL');
  });

  test("a dep-less service declares only its own params", () => {
    const app = compute({}, () => null);

    expect(configOf(app)).toEqual([
      { owner: "service", name: "port", type: "number", secret: false, optional: false, default: 3000 },
    ]);
  });
});

describe("importing a service module", () => {
  test("runs nothing (invariant 3)", async () => {
    const fixture = await import("./fixtures/side-effect-service.ts");

    expect(fixture.handlerCallCount).toBe(0);

    fixture.default.invoke({ db: { url: "x" } }, { port: 3000 });
    expect(fixture.handlerCallCount).toBe(1);
  });
});
