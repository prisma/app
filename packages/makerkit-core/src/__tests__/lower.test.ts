import { describe, expect, test } from "bun:test";
import { defineService } from "../service.ts";
import { postgres } from "../postgres.ts";
import { toResourcePlan, type LowerOptions } from "../lower.ts";

const baseOpts: LowerOptions = {
  workspaceId: "ws_123",
  name: "hello",
  artifactPath: "/tmp/hello.tar.gz",
  artifactHash: "abc123",
};

describe("toResourcePlan", () => {
  test("maps a single postgres-backed service to Project + ComputeService + Deployment", () => {
    const service = defineService({ db: postgres() }, () => null);

    const plan = toResourcePlan(service, baseOpts);

    expect(plan.project).toEqual({
      id: "hello-project",
      workspaceId: "ws_123",
      name: "hello",
    });
    expect(plan.computeService).toEqual({
      id: "hello-svc",
      projectId: "hello-project",
      name: "hello",
      region: "us-east-1",
    });
    expect(plan.deployment).toEqual({
      id: "hello-deploy",
      computeServiceId: "hello-svc",
      artifactPath: "/tmp/hello.tar.gz",
      artifactHash: "abc123",
      port: 3000,
    });
  });

  test("routes postgres() Inputs to the project's default database (no extra resource)", () => {
    const service = defineService({ db: postgres() }, () => null);

    const plan = toResourcePlan(service, baseOpts);

    expect(plan.defaultDatabaseInputs).toEqual(["db"]);
  });

  test("honors region and port overrides", () => {
    const service = defineService({ db: postgres() }, () => null);

    const plan = toResourcePlan(service, { ...baseOpts, region: "eu-west-3", port: 8080 });

    expect(plan.computeService.region).toBe("eu-west-3");
    expect(plan.deployment.port).toBe(8080);
  });

  test("validates the graph before mapping (malformed descriptor rejected)", () => {
    const service = defineService({ db: { nope: true } as never }, () => null);

    expect(() => toResourcePlan(service, baseOpts)).toThrow(/db/);
  });

  test("rejects an unknown dependency kind", () => {
    const service = defineService(
      { cache: { kind: "redis" } as never },
      () => null,
    );

    expect(() => toResourcePlan(service, baseOpts)).toThrow(/cache/);
  });

  test("runs no handler", () => {
    let calls = 0;
    const service = defineService({ db: postgres() }, () => {
      calls += 1;
    });

    toResourcePlan(service, baseOpts);

    expect(calls).toBe(0);
  });
});
