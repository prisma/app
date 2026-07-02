import * as Alchemy from "alchemy";
import { localState } from "alchemy/State/LocalState";
import * as Effect from "effect/Effect";
import * as Prisma from "@makerkit/prisma-alchemy";
import type { ComputeRegion } from "@makerkit/prisma-alchemy";
import { Load } from "./load.ts";
import type { ServiceHandle } from "./service.ts";

/** What the graph can't carry: per-deployment identity, region, and the built artifact. */
export interface LowerOptions {
  /** Prisma workspace that will own the generated project. */
  workspaceId: string;
  /** Stable service/app name (Prisma project + compute service name). */
  name: string;
  /** Path to the prebuilt artifact (`.tar.gz`) the shim entrypoint is bundled into. */
  artifactPath: string;
  /** sha256 of the artifact — a new build (new hash) forces a fresh deployment. */
  artifactHash: string;
  /** Compute region. Defaults to `us-east-1`. */
  region?: ComputeRegion;
  /** HTTP port the service listens on. Defaults to 3000. */
  port?: number;
  /** Alchemy stack name. Defaults to `name`. */
  stackName?: string;
}

/**
 * The prisma-alchemy resource set a single-service graph lowers to. Returned
 * by `toResourcePlan` so the mapping is unit-testable without building a real
 * Alchemy stack. A `postgres()` Input needs no resource of its own here: the
 * project's default database is auto-provisioned and Compute auto-injects its
 * `DATABASE_URL`.
 */
export interface ResourcePlan {
  project: { id: string; workspaceId: string; name: string };
  computeService: { id: string; projectId: string; name: string; region: ComputeRegion };
  deployment: {
    id: string;
    computeServiceId: string;
    artifactPath: string;
    artifactHash: string;
    port: number;
  };
  /** Names of the declared postgres Inputs served by the project's default DB. */
  defaultDatabaseInputs: string[];
}

const DEFAULT_REGION: ComputeRegion = "us-east-1";
const DEFAULT_PORT = 3000;

/**
 * Loads the service graph and describes the prisma-alchemy resources it lowers
 * to, as plain data. Validates the graph (via `Load`) and rejects any
 * dependency kind this slice can't lower. Runs no handler and provisions
 * nothing — this is the deterministic mapping the Alchemy stack is built from.
 */
export function toResourcePlan(service: ServiceHandle, opts: LowerOptions): ResourcePlan {
  const graph = Load(service);

  const defaultDatabaseInputs: string[] = [];
  for (const input of graph.inputs) {
    if (input.descriptor.kind === "postgres") {
      defaultDatabaseInputs.push(input.name);
    } else {
      throw new Error(
        `Cannot lower dependency "${input.name}": kind "${input.descriptor.kind}" is not supported in this slice.`,
      );
    }
  }

  const region = opts.region ?? DEFAULT_REGION;
  const port = opts.port ?? DEFAULT_PORT;

  return {
    project: { id: `${opts.name}-project`, workspaceId: opts.workspaceId, name: opts.name },
    computeService: {
      id: `${opts.name}-svc`,
      projectId: `${opts.name}-project`,
      name: opts.name,
      region,
    },
    deployment: {
      id: `${opts.name}-deploy`,
      computeServiceId: `${opts.name}-svc`,
      artifactPath: opts.artifactPath,
      artifactHash: opts.artifactHash,
      port,
    },
    defaultDatabaseInputs,
  };
}

/**
 * Lowers a service to a runnable Alchemy stack: Project → ComputeService →
 * Deployment, using the existing prisma-alchemy providers. Generated from the
 * loaded graph — the equivalent of a hand-written `alchemy.run.ts`, but
 * derived from the code. Provisions nothing until the Alchemy engine runs it.
 */
export function lower(service: ServiceHandle, opts: LowerOptions) {
  const plan = toResourcePlan(service, opts);

  // The provider collection satisfies each resource's `Provider<T>`
  // requirement at runtime, but Alchemy's `Stack` types the `providers` Layer
  // against the effect body's inferred per-resource requirements (a
  // `NoInfer` position), which the collection's `ProviderCollection` type
  // doesn't structurally unify with. The hand-written `alchemy.run.ts` relies
  // on the same runtime behavior; assert this single argument rather than
  // restating the resource set.
  const providers = Prisma.providers() as never;

  return Alchemy.Stack(
    opts.stackName ?? opts.name,
    { providers, state: localState() },
    Effect.gen(function* () {
      const project = yield* Prisma.Project(plan.project.id, {
        workspaceId: plan.project.workspaceId,
        name: plan.project.name,
      });
      const computeService = yield* Prisma.ComputeService(plan.computeService.id, {
        projectId: project.id,
        name: plan.computeService.name,
        region: plan.computeService.region,
      });
      const deployment = yield* Prisma.Deployment(plan.deployment.id, {
        computeServiceId: computeService.id,
        artifactPath: plan.deployment.artifactPath,
        artifactHash: plan.deployment.artifactHash,
        port: plan.deployment.port,
      });

      return { deployedUrl: deployment.deployedUrl };
    }),
  );
}
