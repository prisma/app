/**
 * The router. Core's only job at deploy: Load (a system root), then for each
 * node look up its control in the config's extension registries — keyed by
 * (node.extension, node.type) — and run what the lookup finds: each
 * extension's application hook once, then per service: resources → provision
 * → build the typed Config → serialize → package → deploy. Deps before
 * dependents, sequenced as Alchemy dependency edges (never statement order —
 * see core-model.md § Lowering). Imports the provisioning substrate
 * (alchemy/effect) — never an extension package.
 */

import type { StackServices } from 'alchemy';
import * as Alchemy from 'alchemy';
import type { State } from 'alchemy/State/State';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import type { ExtensionDescriptor, NodeControl, PrismaAppConfig } from './app-config.ts';
import type { Config } from './config.ts';
import { type Graph, Load, type NodeId } from './graph.ts';
import type { BuildAdapter, ResourceNode, ServiceNode, SystemNode } from './node.ts';

/** The Layer shape every Alchemy state store must satisfy — what `LowerOptions.state` and `PrismaAppConfig.state` both traffic in. */
export type AlchemyStateLayer = Layer.Layer<State, never, StackServices>;

/**
 * An extension's application-level control: the application's shared
 * infrastructure — runs once per lowering, before any node. On Prisma Cloud,
 * the one Project (the config namespace and lifecycle boundary) plus the
 * poison DATABASE_URL variables. Its outputs (projectId) reach the
 * extension's own SPI calls via LowerContext.application.
 */
export interface ApplicationControl {
  provision(ctx: LowerContext): Effect.Effect<LoweredNode, unknown, unknown>;
}

/** The phased service SPI — the seam between the phases belongs to CORE. */
export interface ServiceLowering {
  /**
   * Make the platform-specific thing that will host the service —
   * identity-bearing infrastructure only (e.g. an App), inside the
   * application's Project; no code runs.
   */
  provision(ctx: LowerContext): Effect.Effect<LoweredNode, unknown, unknown>;
  /**
   * Encode the typed Config core built into the service's runtime
   * environment. The extension owns the encoding; its boot-side deserialize
   * (run) reverses it through the same serializer, so writer and reader
   * cannot drift. Returns the env-var records so `deploy` can reference them
   * (the environment edge — see alchemy-lowering.md).
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
 * The bootstrap the extension prints is the ONLY runnable Prisma App adds. It
 * imports the wrapper and calls run with the address AND a boot thunk that
 * imports the app's built entry (`assembled.entry`) — a printed, literal
 * dynamic import, so no bundler ever follows it.
 */
export interface PackageInput {
  /** The build control's normalized output: the bundle dir + the app's runnable. */
  readonly assembled: Bundle;
  /** The node's graph address — baked into the printed bootstrap. */
  readonly address: string;
}

/** One node's realization. Runs inside the Alchemy stack effect. */
export type Lowering = (ctx: LowerContext) => Effect.Effect<LoweredNode, unknown, unknown>;

export interface LowerContext {
  readonly id: NodeId;
  /**
   * The node's deployment address: its full, dot-joined hierarchical
   * position in the graph (GraphNode.id — e.g. "auth.api" for a service
   * provisioned by a system nested inside another system). The config-key
   * namespace and the bootstrap parameter.
   */
  readonly address: string;
  readonly node: ServiceNode | ResourceNode;
  readonly graph: Graph;
  readonly opts: LowerOptions;
  /** The owning extension's application hook outputs (`{ outputs: {} }` when it declares none). */
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
  // The interim carrier of assembled bundle dirs (deploy tooling runs each
  // service's build control and drops this map): one bundle per provisioned
  // service, keyed by the service's full hierarchical address (its graph id).
  readonly bundles: Record<string, Bundle>;
  readonly stage?: string;
  /** Alchemy state store for the stack. Defaults to the config's own state layer. */
  readonly state?: AlchemyStateLayer;
}

/**
 * A build control's normalized product — and the interim assembled-bundle
 * carrier `LowerOptions.bundles` hands to `package()`: the dir the build
 * control produced (wrapper + app entry + fixups) plus the app's runnable
 * entry relative to it (for the bootstrap's boot import). One name, one
 * shape, defined once — every deploy-side package (the CLI, `@prisma/app-
 * assemble`, each extension's build control) imports this instead of
 * redeclaring it.
 */
export interface Bundle {
  readonly dir: string;
  readonly entry: string;
}

/**
 * The build-control seam's input — `@prisma/app-assemble` and every
 * extension's build control (`@prisma/app-node`, `@prisma/app-nextjs`, …)
 * import this one definition rather than each declaring their own.
 */
export interface AssembleInput {
  readonly build: BuildAdapter;
  /**
   * Extra patterns to inline into the wrapper besides `@prisma/app*` — the
   * service module's own imports that are neither shipped in the bundle dir
   * nor runtime built-ins (e.g. the app's workspace packages).
   */
  readonly wrapperNoExternal?: readonly RegExp[];
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
 * input's params matched by name to its producer's lowered outputs, plus
 * service-param defaults. Leaf values are provisioning refs, not strings.
 * Every slot resolves the same way, via its "dependency" edge to whatever
 * the system wired in: a resource's lowered outputs (shared by every consumer
 * wired to it), or a producer service's deploy outputs (already fully
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
    const edge = graph.edges.find(
      (e) => e.to === id && e.input === inputName && e.kind === 'dependency',
    );
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

function missingBundleError(id: NodeId): LowerError {
  return new LowerError(
    `No bundle provided for service "${id}" (opts.bundles["${id}"] is required).`,
  );
}

/** The registries as a two-level map: extension id → descriptor (each descriptor's `nodes` is the second level). A duplicated id is rejected by the CLI's config validation, so last-in-order wins here. */
function extensionsById(config: PrismaAppConfig): ReadonlyMap<string, ExtensionDescriptor> {
  return new Map(config.extensions.map((extension) => [extension.id, extension]));
}

function unknownExtensionError(extension: string, id: NodeId): LowerError {
  return new LowerError(
    `No extension "${extension}" is configured (needed by node "${id}") — add it to ` +
      "prisma-app.config.ts's `extensions` (import its /control entry and list its descriptor).",
  );
}

function unknownNodeTypeError(descriptor: ExtensionDescriptor, type: string): LowerError {
  return new LowerError(
    `Extension "${descriptor.id}" has no control for node type "${type}" ` +
      `(known: ${Object.keys(descriptor.nodes).join(', ')}).`,
  );
}

function wrongKindError(
  extension: string,
  type: string,
  expected: string,
  got: string,
): LowerError {
  return new LowerError(
    `Extension "${extension}"'s control for node type "${type}" is a "${got}" control — ` +
      `this node needs a "${expected}" control.`,
  );
}

/**
 * Looks up one node's control: descriptor by `node.extension`, then control by
 * `node.type`, then the kind check — each failure a LowerError naming the fix.
 */
function controlFor(
  extensions: ReadonlyMap<string, ExtensionDescriptor>,
  node: ServiceNode | ResourceNode,
  id: NodeId,
): Effect.Effect<NodeControl, LowerError> {
  const descriptor = extensions.get(node.extension);
  if (descriptor === undefined) return Effect.fail(unknownExtensionError(node.extension, id));
  const control = descriptor.nodes[node.type];
  if (control === undefined) return Effect.fail(unknownNodeTypeError(descriptor, node.type));
  if (control.kind !== node.kind) {
    return Effect.fail(wrongKindError(node.extension, node.type, node.kind, control.kind));
  }
  return Effect.succeed(control);
}

/**
 * The state-layer precedence a deploy resolves to: an explicit opts.state
 * always wins; failing that, the config's own (required) state. A pure
 * function so the precedence is testable without booting Alchemy.
 */
export function resolveStateLayer(opts: LowerOptions, config: PrismaAppConfig): AlchemyStateLayer {
  return opts.state ?? config.state();
}

/**
 * All configured extensions' providers merged, config array order — an
 * extension without `providers` is skipped; no used-extensions-only
 * filtering (ADR-0017's pinned providers rule).
 */
export function mergedProviders(config: PrismaAppConfig): Layer.Layer<never> {
  const layers = config.extensions.flatMap((extension) =>
    extension.providers !== undefined ? [extension.providers()] : [],
  );
  const [first, ...rest] = layers;
  return first === undefined ? Layer.empty : Layer.mergeAll(first, ...rest);
}

/**
 * Composable form — for MIXED topologies: Prisma App-authored nodes beside
 * hand-wired Alchemy resources in one stack. Runs the same Load → registry
 * walk inside the caller's stack effect and returns the root's LoweredNode,
 * whose outputs (e.g. the deployed URL) hand-wired resources may consume. A
 * system root has no outputs of its own yet (boundary ports are future work)
 * — its lowering returns `{ outputs: {} }`.
 *
 * Error channel: LowerError from routing, PLUS whatever an extension's
 * lowering fails with (their error type is open) — a mixed-stack caller
 * treats failures as deploy-fatal or inspects; it must not assume LowerError
 * is the only inhabitant.
 */
export function lowering(
  root: SystemNode,
  config: PrismaAppConfig,
  opts: LowerOptions,
): Effect.Effect<LoweredNode, LowerError, unknown> {
  return Effect.gen(function* () {
    const graph = Load(root, { id: opts.name });
    const extensions = extensionsById(config);
    const lowered = new Map<NodeId, LoweredNode>();

    // Each extension's application hook runs ONCE, before any node, in config
    // order — its outputs reach that extension's own nodes via ctx.application
    // (the same threading the one-target model had).
    const noApplication: LoweredNode = { outputs: {} };
    const applications = new Map<string, LoweredNode>();
    for (const descriptor of config.extensions) {
      if (descriptor.application === undefined) continue;
      const appCtx: LowerContext = {
        id: graph.root.id,
        address: '',
        // Not a specific node — application provisioning is graph-wide.
        node: graph.root.node as never,
        graph,
        opts,
        application: noApplication,
        lowered,
      };
      applications.set(descriptor.id, yield* descriptor.application.provision(appCtx));
    }

    for (const { id, node } of graph.nodes) {
      if (node.kind === 'system') continue; // the transparent root itself — nothing to lower
      // Dependency slots are edges only, never lowered — only system-provisioned
      // resources and services are.
      if (node.kind === 'dependency') continue;

      // A node's graph id IS its deployment address — the full, dot-joined
      // hierarchical position (system-composition.md § Load: flattening,
      // addresses, validation) — already the same id the bundle correlation
      // key and the config-key namespace both ride.
      const ctx: LowerContext = {
        id,
        address: id,
        node: node as ServiceNode | ResourceNode,
        graph,
        opts,
        application: applications.get(node.extension) ?? noApplication,
        lowered,
      };

      const control = yield* controlFor(extensions, node, id);

      if (control.kind === 'resource') {
        lowered.set(id, yield* control(ctx));
        continue;
      }
      if (control.kind !== 'service') {
        // controlFor already matched kinds; a 'build' control can never match
        // a graph node's kind, so this is unreachable — kept as the exhaustive
        // narrowing TS needs.
        return yield* Effect.fail(
          wrongKindError(node.extension, node.type, node.kind, control.kind),
        );
      }

      const provisioned = yield* control.provision(ctx);
      const typedConfig = buildConfig(node as ServiceNode, id, graph, lowered);
      const serialized = yield* control.serialize(ctx, provisioned, typedConfig);
      const bundle = opts.bundles[id];
      if (bundle === undefined) {
        return yield* Effect.fail(missingBundleError(id));
      }
      const artifact = yield* control.package(ctx, {
        assembled: { dir: bundle.dir, entry: bundle.entry },
        address: id,
      });
      lowered.set(id, yield* control.deploy(ctx, provisioned, artifact, serialized));
    }

    return { outputs: {} };
  }) as Effect.Effect<LoweredNode, LowerError, unknown>;
}

/**
 * The whole-stack wrapper: Load → route each node through the config's
 * extension registries → an Alchemy Stack (the default export the alchemy
 * CLI consumes).
 */
export function lower(root: SystemNode, config: PrismaAppConfig, opts: LowerOptions) {
  // A LowerError at deploy is fatal; orDie moves it off the error channel so
  // the stack effect matches what Alchemy.Stack accepts. The requirements
  // channel is `unknown` by design (the extensions' lowerings carry their own
  // provider requirements, satisfied by the merged providers); the assertion
  // narrows it for Stack's inference.
  const stackEffect = Effect.orDie(lowering(root, config, opts)) as Effect.Effect<
    LoweredNode,
    never
  >;

  return Alchemy.Stack(
    opts.name,
    { providers: mergedProviders(config), state: resolveStateLayer(opts, config) },
    stackEffect,
  );
}
