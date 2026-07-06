/**
 * The authoring + control entry: node factories, Load, configOf, and the
 * model types. Imports nothing — bundling a module that uses this entry
 * ships only this code. (/control carves out of here when the control
 * surface grows.)
 */
export { resource, service, isNode } from "./node.ts";
export type {
  JsonValue,
  JsonObject,
  NodeBase,
  ParamType,
  TypeOf,
  ConfigParam,
  Params,
  Values,
  Connection,
  ConfigAdapter,
  ConfigRequest,
  ResourceNode,
  ServiceNode,
  Deps,
  Hydrated,
  HydratedDeps,
  ServiceHandler,
} from "./node.ts";

export { Load, LoadError } from "./graph.ts";
export type { NodeId, GraphNode, Edge, Graph } from "./graph.ts";

export { configOf } from "./config.ts";
export type { ConfigManifestEntry } from "./config.ts";
