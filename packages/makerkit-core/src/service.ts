import type { Dependencies, Hydrated } from "./descriptors.ts";

/** The hydrated dependencies passed to a service handler, keyed by name. */
export type HydratedDeps<D extends Dependencies> = {
  [K in keyof D]: Hydrated<D[K]>;
};

/** A service's wiring body: hydrated Inputs in, Outputs out. */
export type ServiceHandler<D extends Dependencies> = (deps: HydratedDeps<D>) => unknown;

const SERVICE_HANDLE = Symbol("makerkit.serviceHandle");

/**
 * The handle `defineService` returns: inspectable (the control plane reads
 * `dependencies`) and runnable (the execution plane calls `run` with
 * hydrated deps). Constructing it runs nothing — `run` is never called until
 * something explicitly invokes it.
 */
export interface ServiceHandle<D extends Dependencies = Dependencies> {
  readonly [SERVICE_HANDLE]: true;
  readonly dependencies: D;
  run(deps: HydratedDeps<D>): unknown;
}

/**
 * Defines a Service: `deps` declares its Inputs by name, `handler` is its
 * wiring body. Returns a handle — inert until `run` is called, so importing
 * a service module never executes the handler.
 */
export function defineService<D extends Dependencies>(
  deps: D,
  handler: ServiceHandler<D>,
): ServiceHandle<D> {
  return {
    [SERVICE_HANDLE]: true,
    dependencies: deps,
    run(hydrated) {
      return handler(hydrated);
    },
  };
}

/** True if `value` is a handle returned by `defineService`. */
export function isServiceHandle(value: unknown): value is ServiceHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[SERVICE_HANDLE] === true
  );
}
