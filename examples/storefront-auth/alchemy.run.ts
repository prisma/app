import * as Alchemy from "alchemy";
import { localState } from "alchemy/State/LocalState";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import * as Prisma from "@makerkit/prisma-alchemy";

/**
 * The storefront-auth MVP, provisioned through our v2 Alchemy providers against
 * real Prisma Cloud.
 *
 * Slice 3 deploys the Storefront hex (the Next.js app) on Compute. Slice 4 adds
 * the Auth hex, each hex's Postgres, and wires Auth's URL into the Storefront.
 *
 *   pnpm --filter @makerkit/example-storefront-auth-storefront build:compute
 *   alchemy deploy   # provision project -> compute service -> deployment
 *
 * Requires env: PRISMA_SERVICE_TOKEN, PRISMA_WORKSPACE_ID, ALCHEMY_PASSWORD.
 */
export default Alchemy.Stack(
  "StorefrontAuth",
  { providers: Prisma.providers(), state: localState() },
  Effect.gen(function* () {
    const workspaceId = process.env.PRISMA_WORKSPACE_ID;
    if (!workspaceId) {
      return yield* Effect.die(new Error("PRISMA_WORKSPACE_ID is required"));
    }

    const project = yield* Prisma.Project("storefront-auth", {
      workspaceId,
      name: "makerkit-storefront-auth",
    });

    // Storefront hex — the Next.js app, prebuilt into ./hexes/storefront/dist.
    const artifactPath = fileURLToPath(
      new URL("./hexes/storefront/dist/storefront.tar.gz", import.meta.url),
    );
    const artifactHash = createHash("sha256").update(readFileSync(artifactPath)).digest("hex");

    const storefrontSvc = yield* Prisma.ComputeService("storefront-svc", {
      projectId: project.id,
      name: "storefront",
      region: "us-east-1",
    });

    const storefront = yield* Prisma.Deployment("storefront-deploy", {
      computeServiceId: storefrontSvc.id,
      artifactPath,
      artifactHash,
      port: 3000,
    });

    return {
      projectId: project.id,
      storefrontUrl: storefront.deployedUrl,
    };
  }),
);
