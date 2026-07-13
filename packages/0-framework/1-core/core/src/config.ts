/**
 * The configuration model. Three components, each owned by exactly one
 * party: nodes DECLARE semantic params (pure data, no platform keys); core
 * builds the typed Config from the graph at deploy (buildConfig, in
 * deploy.ts) and consumes it at boot (hydrate, in hydrate.ts); the target
 * pack owns encoding — serializing that Config to the platform environment
 * and reversing it (see core-model.md § Runtime). Core never stringifies and
 * never touches an environment.
 */
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { ServiceNode } from './node.ts';

/**
 * A declared config param — pure data: a caller-owned Standard Schema
 * (ADR-0018) plus a few framework facets. The framework carries the schema,
 * infers the value type from it, and validates with it, without ever
 * enumerating permitted shapes. Turning a value into stored config and back is
 * the deploy target's job, not the param's (ADR-0019) — the same split RPC
 * uses: schema on the declaration, wire owned by the mover.
 */
export interface ConfigParam<S extends StandardSchemaV1 = StandardSchemaV1> {
  readonly schema: S;
  /** Redacted in any introspection output. */
  readonly secret?: boolean;
  /**
   * The platform env-var name a secret param is bound to (set by `envSecret`,
   * ADR-0029). The framework carries only this name — never the value.
   */
  readonly external?: string;
  readonly optional?: boolean;
  readonly default?: StandardSchemaV1.InferOutput<S>;
}

export type Params = Record<string, ConfigParam>;

/** What implementations receive — undefined only for optional params with no default. */
export type Values<P extends Params> = {
  readonly [K in keyof P]: P[K]['optional'] extends true
    ? undefined extends P[K]['default']
      ? StandardSchemaV1.InferOutput<P[K]['schema']> | undefined
      : StandardSchemaV1.InferOutput<P[K]['schema']>
    : StandardSchemaV1.InferOutput<P[K]['schema']>;
};

/**
 * The connection face of a dependency: declared params (data) and how
 * validated values become a client (the hydrate behavior slot). Both P and C
 * are INFERRED — the declaration types hydrate's input; the factory types the
 * loaded dep.
 */
export interface Connection<P extends Params = Params, C = unknown> {
  readonly params: P;
  hydrate(values: Values<P>): C | Promise<C>;
}

/**
 * The enumerable config surface of a service — derivable from the graph
 * alone, nothing booted, no platform keys. The introspection artifact
 * (secrets marked, values absent). `schema` is a data-only projection of the
 * param's Standard Schema (JSON Schema when the vendor supports the optional
 * conversion, a `{ vendor }` tag otherwise) — never the param's functions.
 * Physical locations are the target pack's business.
 */
export interface ConfigDeclaration {
  readonly owner: 'service' | { readonly input: string };
  readonly name: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly secret: boolean;
  /** The platform env-var name a secret param is bound to; omitted for a non-secret param (ADR-0029). */
  readonly external?: string;
  readonly optional: boolean;
  readonly default: unknown;
}

/**
 * The resolved, typed configuration of one service — what crosses the
 * core→pack boundary. Core builds it at deploy (leaf values are provisioning
 * refs, so the env writes depend on the resources/producer — the ordering
 * edges); the pack serializes it, and at boot reconstructs the identical
 * structure with concrete values. Both forms conform to the shape from
 * configOf. Core never stringifies.
 */
export interface Config {
  readonly service: Readonly<Record<string, unknown>>;
  readonly inputs: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/**
 * A data-only descriptor of a param's schema for introspection — the
 * validator's vendor tag, never the schema's own `validate`. `configOf`
 * reports it where the old model reported `type: 'string' | 'number'`, so the
 * config surface stays enumerable without leaking a function. Nothing consumes
 * more than the vendor tag yet; a richer projection (e.g. a JSON-Schema export
 * when the vendor offers one) is an additive change if a consumer needs it.
 */
function projectSchema(schema: StandardSchemaV1): Readonly<Record<string, unknown>> {
  return { vendor: schema['~standard'].vendor };
}

/**
 * Enumerates every config param the service declares: each input's connection
 * params, then the service's own params. Pure — reads `root.inputs`/`params`
 * directly, executes nothing but the (also pure) schema projection. Deliberately
 * does not go through `Load`: a service's connection-end inputs are legitimately
 * unwired from its own point of view (wiring is an enclosing module's concern),
 * and this introspects one service's declared shape regardless of how — or
 * whether — it composes into a larger graph.
 */
export function configOf(root: ServiceNode): readonly ConfigDeclaration[] {
  const entries: ConfigDeclaration[] = [];

  for (const [input, value] of Object.entries(root.inputs)) {
    if (typeof value !== 'object' || value === null) continue;
    // Every dependency input declares `connection.params` in the same shape
    // (Connection<Params, C>) — nothing to narrow before reading it.
    for (const [name, param] of Object.entries(value.connection.params)) {
      entries.push({
        owner: { input },
        name,
        schema: projectSchema(param.schema),
        secret: param.secret === true,
        ...(param.external !== undefined ? { external: param.external } : {}),
        optional: param.optional === true,
        default: param.default,
      });
    }
  }

  for (const [name, param] of Object.entries(root.params)) {
    entries.push({
      owner: 'service',
      name,
      schema: projectSchema(param.schema),
      secret: param.secret === true,
      ...(param.external !== undefined ? { external: param.external } : {}),
      optional: param.optional === true,
      default: param.default,
    });
  }

  return entries;
}

// ——— Param constructors: plain data, target-agnostic (ADR-0018/0019). ———
//
// A param is just a schema plus facets; serialization is the deploy target's
// (see @prisma/compose-prisma-cloud's serializer.ts), so these constructors carry no
// encoding. `string()`/`number()` supply hand-rolled Standard Schemas for the
// common scalars — core needs no arktype dependency for them — and `param()`
// wraps any caller-supplied schema.

function scalarSchema<T>(
  name: string,
  check: (value: unknown) => value is T,
): StandardSchemaV1<T, T> {
  return {
    '~standard': {
      version: 1,
      vendor: '@prisma/compose',
      validate: (value: unknown) =>
        check(value)
          ? { value }
          : { issues: [{ message: `expected ${name}, got ${typeof value}` }] },
    },
  };
}

const stringSchema = scalarSchema<string>('string', (v): v is string => typeof v === 'string');
const numberSchema = scalarSchema<number>(
  'number',
  (v): v is number => typeof v === 'number' && Number.isFinite(v),
);

/**
 * Param facets. `secret` and `default` are mutually exclusive: a secret's value
 * lives on the platform (ADR-0029), so a default would both defeat the
 * deploy-time presence check and put a value into introspection output. The
 * union makes `{ secret: true, default }` a type error; `withFacets` re-checks
 * at runtime for callers that dodge the types.
 */
export type ParamOptions<T> =
  | { readonly secret?: false; readonly optional?: boolean; readonly default?: T }
  | { readonly secret: true; readonly optional?: boolean };

/** `withFacets`' internal option shape — adds `external`, which only `envSecret` sets. */
interface FacetOptions<T> {
  readonly secret?: boolean;
  readonly optional?: boolean;
  readonly default?: T;
  readonly external?: string;
}

const COMPOSE_PREFIX = 'COMPOSE_';
const POISONED_NAMES = new Set(['DATABASE_URL', 'DATABASE_URL_POOLED']);

/**
 * The single construction chokepoint: assembles a ConfigParam and enforces the
 * facet invariants the types express (ADR-0029), so a value that bypasses the
 * types still fails loudly.
 */
function withFacets<S extends StandardSchemaV1>(
  schema: S,
  opts: FacetOptions<StandardSchemaV1.InferOutput<S>>,
): ConfigParam<S> {
  if (opts.secret === true && opts.default !== undefined) {
    throw new Error(
      'a secret config param cannot declare a `default` — its value is provisioned on the platform ' +
        '(ADR-0029); a default would defeat deploy preflight and leak a value into introspection.',
    );
  }
  if (opts.external !== undefined) {
    if (opts.external.startsWith(COMPOSE_PREFIX)) {
      throw new Error(
        `envSecret name "${opts.external}" may not start with "${COMPOSE_PREFIX}" — that prefix is ` +
          "reserved for the framework's own generated config keys.",
      );
    }
    if (POISONED_NAMES.has(opts.external)) {
      throw new Error(
        `envSecret name "${opts.external}" is reserved — ${[...POISONED_NAMES].join(' and ')} are ` +
          'poisoned at project provision and cannot back a secret param.',
      );
    }
  }
  return {
    schema,
    ...(opts.secret !== undefined ? { secret: opts.secret } : {}),
    ...(opts.optional !== undefined ? { optional: opts.optional } : {}),
    ...(opts.default !== undefined ? { default: opts.default } : {}),
    ...(opts.external !== undefined ? { external: opts.external } : {}),
  };
}

/** A string-valued param. */
export function string(
  opts: ParamOptions<string> = {},
): ConfigParam<StandardSchemaV1<string, string>> {
  return withFacets(stringSchema, opts);
}

/** A number-valued param. */
export function number(
  opts: ParamOptions<number> = {},
): ConfigParam<StandardSchemaV1<number, number>> {
  return withFacets(numberSchema, opts);
}

/** A param over any caller-supplied Standard Schema — a structured `jobs`, say. */
export function param<S extends StandardSchemaV1>(
  schema: S,
  opts: ParamOptions<StandardSchemaV1.InferOutput<S>> = {},
): ConfigParam<S> {
  return withFacets(schema, opts);
}

/**
 * A secret string param bound to an explicit platform env-var `name` (ADR-0029).
 * The framework carries only the name; the value is provisioned out-of-band on
 * the platform. `secret` forbids `default`; `optional` is allowed. `name` may
 * not use the reserved `COMPOSE_` prefix or the poisoned `DATABASE_URL(_POOLED)`
 * keys.
 */
export function envSecret(
  name: string,
  opts: { readonly optional?: boolean } = {},
): ConfigParam<StandardSchemaV1<string, string>> {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(
      "envSecret() requires a non-empty platform env-var name, e.g. envSecret('STRIPE_SECRET_KEY').",
    );
  }
  return withFacets(stringSchema, {
    secret: true,
    external: name,
    ...(opts.optional !== undefined ? { optional: opts.optional } : {}),
  });
}
