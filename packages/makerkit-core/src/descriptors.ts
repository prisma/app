import type { SQL } from "bun";

/**
 * Dependency descriptors: neutral data describing an Input a Service
 * declares. Shared by the control plane (Load validates them) and the
 * execution plane (the runtime hydrates them) — this module must stay free
 * of both, so importing it never pulls in provisioning or hydration code.
 *
 * A descriptor carries a phantom `hydratedType` so the handler sees the typed
 * client the runtime will inject (e.g. `postgres()` → `Bun.SQL`). It is a
 * type-only marker — never set at runtime, so the value stays pure data and
 * the `bun` import above is erased.
 */

/** A dependency descriptor for a Postgres Input. No data contract yet (slice 1). */
export interface PostgresDescriptor {
  readonly kind: "postgres";
  readonly hydratedType?: SQL;
}

/** Every descriptor kind a Service can declare as a dependency. */
export type Descriptor = PostgresDescriptor;

/** The map of dependency names to descriptors a `defineService` call declares. */
export type Dependencies = Record<string, Descriptor>;

/** The typed client a descriptor hydrates to — read from its phantom `hydratedType`. */
export type Hydrated<D extends Descriptor> = NonNullable<D["hydratedType"]>;

function isPostgresDescriptor(value: unknown): value is PostgresDescriptor {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "postgres"
  );
}

/** True if `value` is a descriptor `defineService`/`Load` recognizes. */
export function isDescriptor(value: unknown): value is Descriptor {
  return isPostgresDescriptor(value);
}
