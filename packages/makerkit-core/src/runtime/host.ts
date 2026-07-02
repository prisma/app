import { isServiceHandle, type ServiceHandle } from "../service.ts";
import type { Env } from "./postgres.ts";
import { hydrateDescriptor } from "./hydrate.ts";

/**
 * The generated Compute entrypoint (host shim). Hydrates a service's declared
 * Inputs from `env` — reading it here, at the boundary — and calls the user
 * handler with the typed clients. Env terminates here: user code receives
 * only injected dependencies, never `env` or `process.env`.
 *
 * The user handler owns its own server (`Bun.serve`) in this slice — there is
 * no Output/serving model yet — so `run` is expected to start listening and
 * its return value is passed back unchanged.
 */
export function runHost(
  service: ServiceHandle,
  env: Env = process.env,
): unknown {
  if (!isServiceHandle(service)) {
    throw new Error("runHost expects a service handle (the default export of defineService).");
  }

  const hydrated: Record<string, unknown> = {};
  for (const [name, descriptor] of Object.entries(service.dependencies)) {
    hydrated[name] = hydrateDescriptor(descriptor, env);
  }

  // The shim works with an unparameterized handle, so the typed per-descriptor
  // hydrated map is only known dynamically here; the descriptor's hydrator is
  // the source of truth for each client's type.
  return service.run(hydrated as Parameters<typeof service.run>[0]);
}
