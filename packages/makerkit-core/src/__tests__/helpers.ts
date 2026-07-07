import type { Connection, Params, Values } from "../config.ts";

/** A test connection: declared params + a recording/simple hydrate. */
export const conn = <P extends Params, C>(
  params: P,
  make: (values: Values<P>) => C | Promise<C>,
): Connection<P, C> => ({ params, hydrate: make });
