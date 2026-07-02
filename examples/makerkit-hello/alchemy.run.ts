import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { lower } from "@makerkit/core/lower";
import service from "./src/index.ts";

/**
 * The `makerkit-hello` stack, generated from the service by `lower(...)` — the
 * equivalent of a hand-written `alchemy.run.ts`, but derived from the code:
 * one Prisma project (its default Postgres, auto-injected as DATABASE_URL) +
 * one Compute service + one Deployment.
 *
 *   pnpm build     # bundles the shim-wrapped service → dist/hello.tar.gz
 *   pnpm deploy    # builds, sources ../../.env, runs `alchemy deploy`
 *
 * Requires env (repo-root .env, see `pnpm setup:env`):
 * PRISMA_SERVICE_TOKEN, PRISMA_WORKSPACE_ID, ALCHEMY_PASSWORD.
 */
const artifact = fileURLToPath(new URL("./dist/hello.tar.gz", import.meta.url));

const workspaceId = process.env.PRISMA_WORKSPACE_ID;
if (!workspaceId) throw new Error("PRISMA_WORKSPACE_ID is required");

export default lower(service, {
  workspaceId,
  name: "makerkit-hello",
  artifactPath: artifact,
  artifactHash: createHash("sha256").update(readFileSync(artifact)).digest("hex"),
  region: "us-east-1",
  port: 3000,
});
