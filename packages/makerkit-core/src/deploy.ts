/**
 * The router. Core's only job at deploy: Load (a service or hex root), then
 * for each node walk the target's lowering tables and run what they find —
 * application once, then per service: resources → provision → build the
 * typed Config → serialize → package → deploy. Deps before dependents,
 * sequenced as Alchemy dependency edges (never statement order — see
 * core-model.md § Lowering). Imports the provisioning substrate
 * (alchemy/effect) — never a deployment target.
 */
import * as Alchemy from "alchemy";
import type { StackServices } from "alchemy";
import { localState } from "alchemy/State/LocalState";
import type { State } from "alchemy/State/State";
import * as Effect from "effect/Effect";
import type * as Layer from "effect/Layer";
import type { Config } from "./config.ts";
import { Load, type Graph, type NodeId } from "./graph.ts";
import type { HexNode, ResourceNode, ServiceNode } from "./node.ts";

/**
 * What a target pack's /target entry produces — data + per-type SPI
 * functions. The pack is never the actor: these are tools core invokes at
 * moments core chooses; none sees the graph, sequences anything, or calls
 * another.
 */
export interface Target {
  readonly name: string;
  /** The pack's Alchemy providers. */
  providers(): Layer.Layer<never>;
  /** The application's shared infrastructure — runs once, before anything else. */
  readonly application: ApplicationLowering;
  /** Resource type id → one-shot lowering. */
  readonly resources: Record<string, Lowering>;
  /** Service type id → the phased SPI. */
  readonly services: Record<string, ServiceLowering>;
}

/**
 * The application's shared infrastructure: on Prisma Cloud, the one Project
 * (the config namespace and lifecycle boundary) plus the poison DATABASE_URL
 * variables. Its outputs (projectId) reach every later SPI call via
 * LowerContext.application.
 */
export interface ApplicationLowering {
  provision(ctx: LowerContext): Effect.Effect<LoweredNode, unknown, unknown>;
}

/** The phased service SPI — the seam between the phases belongs to CORE. */
export interface ServiceLowering {
  /**
   * Make the target-specific thing that will host the service —
   * identity-bearing infrastructure only (e.g. an App), inside the
   * application's Project; no code runs.
   */
  provision(ctx: LowerContext): Effect.Effect<LoweredNode, unknown, unknown>;
  /**
   * Encode the typed Config core built into the service's runtime
   * environment. The pack owns the encoding; its boot-side deserialize
   * (run) reverses it through the same codec, so writer and reader cannot
   * drift. Returns the env-var records so `deploy` can reference them (the
   * environment edge — see alchemy-lowering.md).
   */
  serialize(
    ctx: LowerContext,
    provisioned: LoweredNode,
    config: Config,
  ): Effect.Effect<LoweredNode, unknown, unknown>;
  /**
   * Print the bootstrap (address baked in — the whole per-instance
   * deployment parameter) and assemble the deployable artifact from the
   * app-built bundle. MUST be byte-deterministic: identical inputs yield an
   * identical hash, so an unchanged service noops on redeploy.
   */
  package(ctx: LowerContext, input: PackageInput): Effect.Effect<Artifact, unknown, unknown>;
  /**
   * Ship the packaged artifact into the provisioned thing and run it.
   * Consumes `serialized`'s env records via the Deployment's environment
   * prop (the edge). Returns the trustworthy URL.
   */
  deploy(
    ctx: LowerContext,
    provisioned: LoweredNode,
    artifact: Artifact,
    serialized: LoweredNode,
  ): Effect.Effect<LoweredNode, unknown, unknown>;
}

/**
 * The bootstrap the pack prints is the ONLY runnable in the artifact and has
 * zero imports beyond the bundle entry — the node carries its own run().
 */
export interface PackageInput {
  /** App-built, from LowerOptions. */
  readonly bundle: Bundle;
  /** The node's graph address — baked into the printed bootstrap. */
  readonly address: string;
}

/** One node's realization. Runs inside the Alchemy stack effect. */
export type Lowering = (ctx: LowerContext) => Effect.Effect<LoweredNode, unknown, unknown>;

export interface LowerContext {
  readonly id: NodeId;
  /**
   * The node's deployment address (graph position): the path of provision
   * ids from the app root, excluding the root itself. Empty ("") for a lone
   * service root — the config codec's "unprefixed" case. The config-key
   * namespace and the bootstrap parameter.
   */
  readonly address: string;
  readonly node: ServiceNode | ResourceNode;
  readonly graph: Graph;
  readonly opts: LowerOptions;
  /** The application provision's outputs. */
  readonly application: LoweredNode;
  /** Already-lowered deps (topo order). */
  readonly lowered: ReadonlyMap<NodeId, LoweredNode>;
}

/**
 * What a lowering hands downstream — e.g. a deployed URL a later node's env
 * wiring consumes. The inter-node config-wiring hook for Connections.
 */
export interface LoweredNode {
  readonly outputs: Readonly<Record<string, unknown>>;
}

export interface LowerOptions {
  /** Stack + root node id. */
  readonly name: string;
  // Bundles are app-built (MakerKit does not bundle app code). Service root:
  // one bundle. Hex root: one per provisioned service, keyed by provision id.
  readonly bundle?: Bundle;
  readonly bundles?: Record<string, Bundle>;
  readonly stage?: string;
  /** Alchemy state store for the stack. Defaults to local state. */
  readonly state?: Layer.Layer<State, never, StackServices>;
}

/** entry default: main.js|main.mjs. */
export interface Bundle {
  readonly dir: string;
  readonly entry?: string;
}

/** package()'s product. */
export interface Artifact {
  readonly path: string;
  readonly sha256: string;
}

export class LowerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LowerError';
  }
}

/**
 * Deploy-side: assembles the typed Config for one service — each declared
 * input's params matched by name to its producer's/resource's lowered
 * outputs, plus service-param defaults. Leaf values are provisioning refs,
 * not strings. Resource inputs resolve via the graph's "input" edge (the
 * resource's own lowered outputs); ConnectionEnd inputs resolve via the
 * "connection" edge (the PRODUCER SERVICE's outputs — already fully
 * deployed in topo order, so its URL is real — PRO-200).
 */
export function buildConfig(
  node: ServiceNode,
  id: NodeId,
  graph: Graph,
  lowered: ReadonlyMap<NodeId, LoweredNode>,
): Config {
  const inputs: Record<string, Record<string, unknown>> = {};

  for (const [inputName, inputNode] of Object.entries(node.inputs)) {
    const wantKind = inputNode.kind === "connection" ? "connection" : "input";
    const edge = graph.edges.find((e) => e.to === id && e.input === inputName && e.kind === wantKind);
    const producedOutputs = edge !== undefined ? (lowered.get(edge.from)?.outputs ?? {}) : {};
    const values: Record<string, unknown> = {};
    for (const name of Object.keys(inputNode.connection.params)) {
      values[name] = producedOutputs[name];
    }
    inputs[inputName] = values;
  }

  const service: Record<string, unknown> = {};
  for (const [name, param] of Object.entries(node.params)) {
    if (param.default !== undefined) service[name] = param.default;
  }

  return { service, inputs };
}

function resolveBundle(opts: LowerOptions, id: NodeId, isHexRoot: boolean): Bundle | undefined {
  return isHexRoot ? opts.bundles?.[id] : opts.bundle;
}

function missingBundleError(id: NodeId, isHexRoot: boolean): LowerError {
  const where = isHexRoot ? `opts.bundles["${id}"]` : "opts.bundle";
  return new LowerError(`No bundle provided for service "${id}" (${where} is required).`);
}

/**
 * Composable form — for MIXED topologies: MakerKit-authored nodes beside
 * hand-wired Alchemy resources in one stack. Runs the same Load → route walk
 * inside the caller's stack effect and returns the root's LoweredNode, whose
 * outputs (e.g. the deployed URL) hand-wired resources may consume. A hex
 * root has no outputs of its own yet (boundary ports are future work) — its
 * lowering returns `{ outputs: {} }`.
 *
 * Error channel: LowerError from routing, PLUS whatever a pack lowering
 * fails with (their error type is open) — a mixed-stack caller treats
 * failures as deploy-fatal or inspects; it must not assume LowerError is the
 * only inhabitant.
 */
export function lowering(
  root: ServiceNode | HexNode,
  target: Target,
  opts: LowerOptions,
): Effect.Effect<LoweredNode, LowerError, unknown> {
  return Effect.gen(function* () {
    const graph = Load(root, { id: opts.name });
    const isHexRoot = graph.root.node.kind === "hex";
    const lowered = new Map<NodeId, LoweredNode>();

    // Every hex-provisioned service's own graph id IS its address (single-
    // level hex only — nesting is out of scope); a lone service root has no
    // address of its own — "" is the config codec's unprefixed case.
    const serviceAddress = new Map<NodeId, string>();
    if (isHexRoot) {
      for (const { id, node } of graph.nodes) {
        if (node.kind === "service") serviceAddress.set(id, id);
      }
    } else {
      serviceAddress.set(graph.root.id, "");
    }

    const appCtx: LowerContext = {
      id: graph.root.id,
      address: "",
      // Not a specific node — application provisioning is graph-wide.
      node: graph.root.node as never,
      graph,
      opts,
      application: { outputs: {} },
      lowered,
    };
    const application = yield* target.application.provision(appCtx);

    for (const { id, node } of graph.nodes) {
      if (node.kind === "hex") continue; // the transparent root itself — nothing to lower
      if (node.kind === "connection") continue; // ConnectionEnd: an edge only, never lowered

      const address = serviceAddress.get(id) ?? "";
      const ctx: LowerContext = {
        id,
        address,
        node: node as ServiceNode | ResourceNode,
        graph,
        opts,
        application,
        lowered,
      };

      if (node.kind === "resource") {
        const lowerResource = target.resources[node.type];
        if (lowerResource === undefined) {
          return yield* Effect.fail(
            new LowerError(
              `Target "${target.name}" has no resource lowering for type "${node.type}" ` +
                `(known: ${Object.keys(target.resources).join(", ")}).`,
            ),
          );
        }
        lowered.set(id, yield* lowerResource(ctx));
        continue;
      }

      const serviceLowering = target.services[node.type];
      if (serviceLowering === undefined) {
        return yield* Effect.fail(
          new LowerError(
            `Target "${target.name}" has no service lowering for type "${node.type}" ` +
              `(known: ${Object.keys(target.services).join(", ")}).`,
          ),
        );
      }

      const provisioned = yield* serviceLowering.provision(ctx);
      const config = buildConfig(node as ServiceNode, id, graph, lowered);
      const serialized = yield* serviceLowering.serialize(ctx, provisioned, config);
      const bundle = resolveBundle(opts, id, isHexRoot);
      if (bundle === undefined) {
        return yield* Effect.fail(missingBundleError(id, isHexRoot));
      }
      const artifact = yield* serviceLowering.package(ctx, { bundle, address });
      lowered.set(id, yield* serviceLowering.deploy(ctx, provisioned, artifact, serialized));
    }

    return isHexRoot ? { outputs: {} } : (lowered.get(graph.root.id) as LoweredNode);
  }) as Effect.Effect<LoweredNode, LowerError, unknown>;
}

/**
 * The whole-stack wrapper: Load → route each node through the target's
 * tables → an Alchemy Stack (the default export the alchemy CLI consumes).
 */
export function lower(root: ServiceNode | HexNode, target: Target, opts: LowerOptions) {
  // A LowerError at deploy is fatal; orDie moves it off the error channel so
  // the stack effect matches what Alchemy.Stack accepts. The requirements
  // channel is `unknown` by design (the pack's lowerings carry their own
  // provider requirements, satisfied by target.providers()); the assertion
  // narrows it for Stack's inference.
  const stackEffect = Effect.orDie(lowering(root, target, opts)) as Effect.Effect<
    LoweredNode,
    never
  >;

  return Alchemy.Stack(
    opts.name,
    { providers: target.providers(), state: opts.state ?? localState() },
    stackEffect,
  );
}
