import { afterAll, describe, expect, test } from "bun:test";
import { $ } from "bun";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildServiceArtifact, hostEntrySource } from "../build/artifact.ts";

const fixtureService = path.join(
  import.meta.dir,
  "fixtures",
  "artifact-service.ts",
);

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "makerkit-artifact-test-"));

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("hostEntrySource", () => {
  test("imports the user service and hands it to runHost", () => {
    const src = hostEntrySource("/abs/path/service.ts");
    expect(src).toContain('import { runHost } from "@makerkit/core/runtime"');
    expect(src).toContain('import service from "/abs/path/service.ts"');
    expect(src).toContain("runHost(service)");
  });
});

describe("buildServiceArtifact", () => {
  test("produces a tar.gz whose entrypoint is the shim, user service bundled in", async () => {
    const outFile = path.join(workDir, "hello.tar.gz");

    const result = await buildServiceArtifact({ service: fixtureService, outFile });

    expect(fs.existsSync(result.outFile)).toBe(true);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);

    const extractDir = path.join(workDir, "extract");
    fs.mkdirSync(extractDir, { recursive: true });
    await $`tar -xzf ${outFile} -C ${extractDir}`.quiet();

    const manifest = JSON.parse(
      fs.readFileSync(path.join(extractDir, "compute.manifest.json"), "utf8"),
    );
    expect(manifest.entrypoint).toBe("index.js");
    expect(manifest.manifestVersion).toBe("1");

    const bundle = fs.readFileSync(path.join(extractDir, "index.js"), "utf8");
    // The shim wraps the user service: the bundle calls runHost and includes
    // the user handler's marker.
    expect(bundle).toContain("runHost");
    expect(bundle).toContain("ARTIFACT_FIXTURE_MARKER");
  }, 30_000);
});
