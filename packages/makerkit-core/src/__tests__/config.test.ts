import { describe, expect, test } from "bun:test";
import { configOf } from "../config.ts";
import { resource, service } from "../node.ts";
import { conn, testHost } from "./helpers.ts";

describe("configOf", () => {
  test("enumerates input fields through the host's key rule, secrets marked", () => {
    const root = service({
      type: "fake/app",
      inputs: {
        db: resource({
          type: "fake/db",
          connection: conn([{ name: "url", secret: true }, { name: "schema", optional: true }], () => ({})),
        }),
      },
      host: testHost,
      handler: () => null,
    });

    const manifest = configOf(root);

    expect(manifest).toEqual([
      { input: "db", field: "url", channel: "env", key: "DB_URL", secret: true, optional: false },
      { input: "db", field: "schema", channel: "env", key: "DB_SCHEMA", secret: false, optional: true },
      { field: "port", channel: "env", key: "PORT", secret: false, default: 3000, optional: true },
    ]);
  });

  test("context fields resolve via ContextField.key, not the input key rule", () => {
    const root = service({
      type: "fake/app",
      inputs: {},
      host: {
        channel: "env",
        key: () => {
          throw new Error("key() must not be called for context fields");
        },
        context: [{ name: "port", key: "LISTEN_PORT" }],
      },
      handler: () => null,
    });

    const manifest = configOf(root);

    expect(manifest).toEqual([
      { field: "port", channel: "env", key: "LISTEN_PORT", secret: false, optional: false },
    ]);
  });

  test("a dep-less service enumerates only context fields", () => {
    const root = service({ type: "fake/app", inputs: {}, host: testHost, handler: () => null });

    expect(configOf(root)).toEqual([
      { field: "port", channel: "env", key: "PORT", secret: false, default: 3000, optional: true },
    ]);
  });

  test("executes nothing", () => {
    let handlerCalls = 0;
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
      },
      host: testHost,
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
