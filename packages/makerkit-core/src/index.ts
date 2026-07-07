/**
 * The authoring + control entry: node factories, Load, configOf, hydrate,
 * and the model types. Imports nothing — bundling a module that uses this
 * entry ships only this code. (/control carves out of here when the control
 * surface grows.) Pure barrel — no implementations live here.
 */
export { resource, service, connectionEnd, hex, isNode } from "./node.ts";
export type {
  NodeBase,
  ResourceNode,
  ServiceNode,
  RunnableServiceNode,
  ConnectionEnd,
  HexNode,
  HexBuilder,
  ProvisionedRef,
  Deps,
  Hydrated,
  HydratedDeps,
  NodeBase,
  ResourceNode,
  ServiceHandler,
} from "./node.ts";

export { Load, LoadError } from "./graph.ts";
export type { NodeId, GraphNode, Edge, Graph } from "./graph.ts";

export { configOf } from "./config.ts";
export type {
  ParamType,
  TypeOf,
  ConfigParam,
  Params,
  Values,
  Connection,
  ConfigDeclaration,
  Config,
} from "./config.ts";

export { hydrate } from "./hydrate.ts";
