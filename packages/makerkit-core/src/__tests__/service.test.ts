import { describe, expect, test } from "bun:test";
import { defineService, isServiceHandle } from "../index.ts";
import { postgres } from "../postgres.ts";

describe("defineService", () => {
  test("returns a handle exposing the declared dependency descriptors", () => {
    const db = postgres();
    const service = defineService({ db }, () => ({}));

    expect(isServiceHandle(service)).toBe(true);
    expect(service.dependencies).toEqual({ db: { kind: "postgres" } });
    expect(service.dependencies.db).toBe(db);
  });

  test("returns a handle runnable with hydrated deps", () => {
    const service = defineService(
      { db: postgres() },
      ({ db }) => ({ echoed: db }),
    );

    const fakeDb = { query: () => "fake" } as never;
    const result = service.run({ db: fakeDb });

    expect(result).toEqual({ echoed: fakeDb });
  });

  test("does not run the handler when defined", () => {
    let calls = 0;
    defineService({ db: postgres() }, () => {
      calls += 1;
      return {};
    });

    expect(calls).toBe(0);
  });
});

describe("importing a service module", () => {
  test("does not execute the handler", async () => {
    const fixture = await import("./fixtures/side-effect-service.ts");

    expect(fixture.handlerCallCount).toBe(0);
    expect(isServiceHandle(fixture.default)).toBe(true);

    fixture.default.run({ db: {} as never });
    expect(fixture.handlerCallCount).toBe(1);
  });
});
