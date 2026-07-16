import { isParamSource, type ParamBinding, type ParamSource, paramSource } from '@internal/core';
import { blindCast } from '@internal/foundation/casts';

/**
 * Brands the payload `envParam` builds. Core's `paramSource()` is a public
 * SPI, so a user could bypass `envParam` and bind a raw `paramSource('x')`;
 * the brand lets `paramName` reject such a source (or another target's) with
 * a clear error instead of reading an absent `.name`.
 */
const PRISMA_CLOUD_PARAM_SOURCE: unique symbol = blindCast<
  never,
  'unique-symbol brand for the prisma-cloud envParam payload'
>(Symbol.for('prisma:prisma-cloud-param-source'));

/** The Prisma Cloud param source payload: the platform env-var name the slot resolves to, under a brand only `envParam` sets. */
export interface EnvParamPayload {
  readonly [PRISMA_CLOUD_PARAM_SOURCE]: true;
  readonly name: string;
}

const RESERVED_PARAM_PREFIX = 'COMPOSER_';
const POISONED_PARAM_NAMES: ReadonlySet<string> = new Set(['DATABASE_URL', 'DATABASE_URL_POOLED']);

/**
 * Binds a param slot to a named Prisma Cloud platform env var — the non-secret
 * sibling of `envSecret` (spec: env-sourced config params). The platform
 * injects the value into the running instance per stage; the param's own
 * schema validates it at boot, unredacted. The name may not use the
 * framework's reserved `COMPOSER_` prefix or the poisoned
 * `DATABASE_URL(_POOLED)` keys — same parity as `envSecret`.
 */
export function envParam(name: string): ParamSource<EnvParamPayload> {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(
      "envParam() requires a non-empty platform env-var name, e.g. envParam('APP_ORIGIN').",
    );
  }
  if (name.startsWith(RESERVED_PARAM_PREFIX)) {
    throw new Error(
      `envParam name "${name}" may not start with "${RESERVED_PARAM_PREFIX}" — that prefix is ` +
        "reserved for the framework's own generated config keys.",
    );
  }
  if (POISONED_PARAM_NAMES.has(name)) {
    throw new Error(
      `envParam name "${name}" is reserved — ${[...POISONED_PARAM_NAMES].join(' and ')} are ` +
        'poisoned at project provision and cannot back a param.',
    );
  }
  return paramSource<EnvParamPayload>({ [PRISMA_CLOUD_PARAM_SOURCE]: true, name });
}

/** True only for a payload that `envParam` built — i.e. one carrying the brand. */
function isEnvParamPayload(payload: unknown): payload is EnvParamPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    blindCast<
      Record<PropertyKey, unknown>,
      'reading the prisma-cloud envParam brand off an unknown payload'
    >(payload)[PRISMA_CLOUD_PARAM_SOURCE] === true
  );
}

/** True iff a resolved param value is an env-sourced pointer this target built (as opposed to a literal, or a foreign/raw `ParamSource`). */
export function isEnvParamSource(value: unknown): value is ParamSource<EnvParamPayload> {
  return isParamSource(value) && isEnvParamPayload(value.payload);
}

/**
 * Reads the Prisma Cloud env-var name back out of a param binding's opaque
 * source. A source not built by `envParam` (a raw `paramSource(...)` or
 * another target's source) carries no name — reject it here. `paramName` runs
 * in preflight and at serialize before any value ever crosses the wire, so a
 * foreign source fails early and clearly rather than producing a broken
 * deploy with an undefined name.
 */
export function paramName(binding: ParamBinding): string {
  const { binding: bound } = binding;
  if (!isEnvParamSource(bound)) {
    throw new Error(
      `param slot "${binding.slot}" of service "${binding.serviceAddress}" is bound to a source ` +
        "not created by envParam() — bind env-sourced params with envParam('NAME') from " +
        '@prisma/composer-prisma-cloud.',
    );
  }
  return bound.payload.name;
}

/**
 * Finds the manifest entry for one service param slot. `serialize` calls this
 * only after confirming `buildConfig` resolved the slot to a `ParamSource`
 * (`isParamSource(value)`), so a miss here means `graph.params` and the
 * resolved `Config` have drifted — a Load invariant violation, surfaced
 * loudly rather than producing a pointer row with an undefined name.
 */
export function paramBindingFor(
  bindings: readonly ParamBinding[],
  serviceAddress: string,
  slot: string,
): ParamBinding {
  const binding = bindings.find((b) => b.serviceAddress === serviceAddress && b.slot === slot);
  if (binding === undefined) {
    throw new Error(
      `param slot "${slot}" of "${serviceAddress}" resolved to a source but has no bound entry in ` +
        'the manifest — Load should have recorded it.',
    );
  }
  return binding;
}
