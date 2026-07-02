import { describe, expect, test } from "bun:test";
import { defineService } from "../service.ts";
import { postgres } from "../postgres.ts";
import { runHost } from "../runtime/host.ts";

describe("runHost", () => {
  test("hydrates declared deps from env and calls the handler with them", () => {
    let received: unknown;
    const service = defineService({ db: postgres() }, (deps) => {
      received = deps;
      return "served";
    });

    const result = runHost(service, {
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
    });

    expect(result).toBe("served");
    const deps = received as { db: unknown };
    expect(typeof deps.db).toBe("function");
    expect(typeof (deps.db as { close?: unknown }).close).toBe("function");
  });

  test("passes one hydrated client per declared dependency, keyed by name", () => {
    let received: Record<string, unknown> = {};
    const service = defineService(
      { primary: postgres(), replica: postgres() },
      (deps) => {
        received = deps as Record<string, unknown>;
        return null;
      },
    );

    runHost(service, { DATABASE_URL: "postgres://user:pass@localhost:5432/db" });

    expect(Object.keys(received).sort()).toEqual(["primary", "replica"]);
  });

  test("does not run the handler until invoked (defineService is inert)", () => {
    let calls = 0;
    defineService({ db: postgres() }, () => {
      calls += 1;
    });

    expect(calls).toBe(0);
  });

  test("surfaces a missing DATABASE_URL as a hydration error", () => {
    const service = defineService({ db: postgres() }, () => null);

    expect(() => runHost(service, {})).toThrow(/DATABASE_URL/);
  });

  test("rejects anything that isn't a service handle", () => {
    expect(() => runHost({} as never, {})).toThrow(/service handle/);
  });
});
