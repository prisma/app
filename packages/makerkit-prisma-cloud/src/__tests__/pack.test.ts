import { describe, expect, test } from "bun:test";
import { configOf, isNode } from "@makerkit/core";
import { ConfigError, runHost } from "@makerkit/core/runtime";
import { compute, postgres } from "../index.ts";

describe("postgres({ client })", () => {
  test("returns a branded resource node carrying the connection: url field, secret", () => {
    const node = postgres({ client: ({ url }) => ({ url }) });

    expect(isNode(node)).toBe(true);
    expect(node.kind).toBe("resource");
    expect(node.type).toBe("prisma-cloud/postgres");
    expect(node.connection.config).toEqual([{ name: "url", secret: true }]);
  });

  test("hydrate delegates to the app's client factory; C is inferred", () => {
    const made: unknown[] = [];
    const node = postgres({
      client: (config) => {
        made.push(config);
        return { fake: "client", ...config };
      },
    });

    const client = node.connection.hydrate({ url: "postgres://u:p@host:5432/db" });

    expect(made).toEqual([{ url: "postgres://u:p@host:5432/db" }]);
    expect(client).toEqual({ fake: "client", url: "postgres://u:p@host:5432/db" });
  });
});

describe("compute()", () => {
  test("returns a branded service node carrying Compute's host convention", () => {
    const node = compute({}, () => null);

    expect(isNode(node)).toBe(true);
    expect(node.kind).toBe("service");
    expect(node.type).toBe("prisma-cloud/compute");
    expect(node.host.channel).toBe("env");
    expect(node.host.key("db", "url")).toBe("DATABASE_URL");
    expect(node.host.key("db", "other")).toBe("OTHER");
    expect(node.host.context).toEqual([{ name: "port", key: "PORT", default: 3000 }]);
  });

  test("is inert until run", () => {
    let calls = 0;
    const db = postgres({ client: ({ url }) => ({ url }) });
    const node = compute({ db }, () => {
      calls += 1;
      return null;
    });

    expect(node.inputs.db).toBe(db);
    expect(calls).toBe(0);
  });
});

describe("importing a service module", () => {
  test("runs nothing (invariant 3)", async () => {
    const fixture = await import("./fixtures/side-effect-service.ts");

    expect(fixture.handlerCallCount).toBe(0);

    fixture.default.run({ db: { url: "x" } }, { port: 3000 });
    expect(fixture.handlerCallCount).toBe(1);
  });
});

describe("the config pipeline over pack nodes", () => {
  test("configOf enumerates DATABASE_URL (secret) and PORT (default 3000)", () => {
    const app = compute({ db: postgres({ client: ({ url }) => ({ url }) }) }, () => null);

    expect(configOf(app)).toEqual([
      {
        input: "db",
        field: "url",
        channel: "env",
        key: "DATABASE_URL",
        secret: true,
        optional: false,
      },
      { field: "port", channel: "env", key: "PORT", secret: false, default: 3000, optional: true },
    ]);
  });

  test("end to end: runHost hydrates through the connection and passes the context", () => {
    let received: unknown;
    let ctx: unknown;
    const app = compute(
      { db: postgres({ client: ({ url }) => ({ url }) }) },
      (deps, c) => {
        received = deps;
        ctx = c;
        return "served";
      },
    );

    const result = runHost(app, { env: { DATABASE_URL: "postgres://x", PORT: "4001" } });

    expect(result).toBe("served");
    expect(received).toEqual({ db: { url: "postgres://x" } });
    expect(ctx).toEqual({ port: 4001 });
  });

  test("field-level override boots with no env", () => {
    let received: unknown;
    const app = compute(
      { db: postgres({ client: ({ url }) => ({ url }) }) },
      (deps) => {
        received = deps;
        return null;
      },
    );

    runHost(app, { env: {}, config: { "db.url": "postgres://test" } });

    expect(received).toEqual({ db: { url: "postgres://test" } });
  });

  test("a missing DATABASE_URL is a ConfigError before any hydrate", () => {
    let factoryCalls = 0;
    const app = compute(
      {
        db: postgres({
          client: ({ url }) => {
            factoryCalls += 1;
            return { url };
          },
        }),
      },
      () => null,
    );

    expect(() => runHost(app, { env: {} })).toThrow(ConfigError);
    expect(() => runHost(app, { env: {} })).toThrow(/DATABASE_URL/);
    expect(factoryCalls).toBe(0);
  });

  test("a dep-less service boots with zero declared config", () => {
    let ctx: unknown;
    const app = compute({}, (_deps, c) => {
      ctx = c;
      return "booted";
    });

    expect(runHost(app, { env: {} })).toBe("booted");
    expect(ctx).toEqual({ port: 3000 });
  });
});
