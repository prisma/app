import { describe, expect, test } from "bun:test";
import { hydrate } from "../hydrate.ts";
import { connectionEnd, resource, service } from "../node.ts";
import { conn } from "./helpers.ts";

const dbNode = (record?: (values: { url: string }) => void) =>
  resource({
    type: "fake/db",
    connection: conn({ url: { type: "string", secret: true } }, (v) => {
      record?.(v);
      return { client: v.url };
    }),
  });

const portParams = { port: { type: "number", default: 3000 } } as const;

describe("hydrate", () => {
  test("calls each input's connection.hydrate with its typed Config slice", async () => {
    const made: unknown[] = [];
    const root = service({
      type: "fake/app",
      inputs: { db: dbNode((v) => made.push(v)) },
      params: portParams,
      handler: () => null,
    });

    const deps = await hydrate(root, { service: { port: 8080 }, inputs: { db: { url: "postgres://x" } } });

    expect(made).toEqual([{ url: "postgres://x" }]);
    expect(deps).toEqual({ db: { client: "postgres://x" } });
  });

  test("a ConnectionEnd hydrates through identical machinery — the handler cannot tell it apart", async () => {
    const root = service({
      type: "fake/app",
      inputs: {
        auth: connectionEnd({
          type: "fake/http",
          connection: conn({ url: { type: "string" } }, (v) => ({ fetchBase: v.url })),
        }),
      },
      params: {},
      handler: () => null,
    });

    const deps = await hydrate(root, { service: {}, inputs: { auth: { url: "https://auth.example" } } });

    expect(deps).toEqual({ auth: { fetchBase: "https://auth.example" } });
  });

  test("async hydrate is awaited", async () => {
    const root = service({
      type: "fake/app",
      inputs: {
        db: resource({
          type: "fake/db",
          connection: conn({ url: { type: "string" } }, async (v) => {
            await Promise.resolve();
            return { asyncClient: v.url };
          }),
        }),
      },
      params: {},
      handler: () => null,
    });

    const deps = await hydrate(root, { service: {}, inputs: { db: { url: "postgres://x" } } });

    expect(deps).toEqual({ db: { asyncClient: "postgres://x" } });
  });

  test("a dep-less service hydrates to an empty deps object", async () => {
    const root = service({ type: "fake/app", inputs: {}, params: portParams, handler: () => null });

    expect(await hydrate(root, { service: { port: 3000 }, inputs: {} })).toEqual({});
  });

  test("does not call the handler — that's the caller's separate step", async () => {
    let handlerCalls = 0;
    const root = service({
      type: "fake/app",
      inputs: { db: dbNode() },
      params: {},
      handler: () => {
        handlerCalls += 1;
        return null;
      },
    });

    await hydrate(root, { service: {}, inputs: { db: { url: "postgres://x" } } });

    expect(handlerCalls).toBe(0);
  });
});

describe("node.invoke as the DI test path", () => {
  test("injecting typed fakes and calling invoke directly needs no environment, no hydrate", () => {
    let received: unknown;
    let ctx: unknown;
    const root = service({
      type: "fake/app",
      inputs: { db: dbNode() },
      params: portParams,
      handler: (deps, c) => {
        received = deps;
        ctx = c;
        return "served";
      },
    });

    const fakeDb = { client: "fake" };
    const result = root.invoke({ db: fakeDb }, { port: 0 });

    expect(result).toBe("served");
    expect(received).toEqual({ db: fakeDb });
    expect(ctx).toEqual({ port: 0 });
  });
});
