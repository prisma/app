import { configOf, hydrate, service } from "@makerkit/core";
import type { Deps, RunnableServiceNode, ServiceHandler } from "@makerkit/core";
import { deserialize } from "./codec.ts";

const computeParams = { port: { type: 'number', default: 3000 } } as const;

/**
 * A Prisma Compute service: inputs + handler, inert until run. Returns the
 * pack's RUNNABLE subclass — `run(address)` is the whole boot loop:
 * deserialize the platform environment (keyed off `address`, the pack's ONE
 * env read) into a typed Config, then core's hydrate + invoke.
 */
export const compute = <D extends Deps>(
  deps: D,
  handler: ServiceHandler<D, typeof computeParams>,
): RunnableServiceNode<D, typeof computeParams> => {
  const node = service({ type: "prisma-cloud/compute", inputs: deps, params: computeParams, handler });
  return Object.freeze({
    ...node,
    async run(address: string) {
      const config = deserialize(configOf(node), address);
      return node.invoke(await hydrate(node, config) as never, config.service as never);
    },
  }) as RunnableServiceNode<D, typeof computeParams>;
};
