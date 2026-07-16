import type {
  BuildAdapter,
  Config,
  Deps,
  Expose,
  HydratedDeps,
  Params,
  RunnableServiceNode,
  Secrets,
  SecretValues,
  Values,
} from '@internal/core';
import { hydrateSecrets, hydrateSync, number, service } from '@internal/core';
import { blindCast } from '@internal/foundation/casts';
import { configKey, deserialize, deserializeSecrets, stash, stashSecrets } from './serializer.ts';

const reservedParams = { port: number({ default: 3000 }) } as const;
type ReservedParams = typeof reservedParams;

/**
 * A Prisma Compute service — declarations only (deps + params + build + the
 * ports it exposes), no descriptor. `params` merges with the reserved
 * `ReservedParams` (`port`); a user param whose name collides with a reserved
 * one fails at authoring, the same way a colliding dependency name does.
 * Returns the extension's runnable/loadable node:
 *   · run(address, boot) — the process controller: deserialize the platform
 *     environment (keyed off `address`, the extension's ONE env read) into a
 *     typed Config, re-emit it under address-free process-local stash keys,
 *     then call boot() to start the app's entry.
 *   · load() / config() — called from inside the app's entry: read the stash;
 *     load() hydrates + memoizes the deps, config() returns the typed params.
 *     Separate accessors so a dep and a param never share a namespace (ADR-0021).
 *
 * `service()`'s underlying node carries `extension: '@prisma/composer-prisma-cloud'` —
 * the control-plane registry key `prisma-composer deploy` resolves through the
 * app's `prisma-composer.config.ts` (ADR-0017). This module loads nothing at
 * deploy time; nodes are pure data.
 */
/**
 * Copies `COMPOSER_<address>_<rest>` to `COMPOSER_<rest>` for every var of this
 * service's address. Derives both names through `configKey`, so it cannot drift
 * from what deploy wrote.
 */
function restashAddressFree(address: string): void {
  const prefix = configKey(address, { owner: 'service', name: '' });
  // An empty address already IS the address-free form — nothing to re-key.
  if (prefix === configKey('', { owner: 'service', name: '' })) return;
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || !key.startsWith(prefix)) continue;
    process.env[configKey('', { owner: 'service', name: key.slice(prefix.length) })] = value;
  }
}

export const compute = <
  D extends Deps,
  P extends Params = Record<never, never>,
  E extends Expose = Record<never, never>,
  S extends Secrets = Record<never, never>,
>(def: {
  name: string;
  deps: D;
  params?: P;
  secrets?: S;
  build: BuildAdapter;
  expose?: E;
}): RunnableServiceNode<D, P & ReservedParams, E, S> => {
  const userParams = def.params ?? blindCast<P, 'no user params supplied'>({});

  // load() merges deps and service params into one object; a dep or a user
  // param whose name collides with a reserved param would be silently
  // clobbered. Fail at authoring instead.
  for (const reserved of Object.keys(reservedParams)) {
    if (reserved in def.deps) {
      throw new Error(
        `compute(): dependency "${reserved}" collides with the reserved service param of the same name — rename the dependency.`,
      );
    }
    if (reserved in userParams) {
      throw new Error(
        `compute(): param "${reserved}" collides with the reserved service param of the same name — rename the param.`,
      );
    }
  }

  const params = blindCast<P & ReservedParams, 'reserved params merged over user params'>({
    ...userParams,
    ...reservedParams,
  });
  const node = service<D, P & ReservedParams, E, S>({
    name: def.name,
    extension: '@prisma/composer-prisma-cloud',
    type: 'compute',
    inputs: def.deps,
    params,
    ...(def.secrets !== undefined ? { secrets: def.secrets } : {}),
    build: def.build,
    ...(def.expose !== undefined ? { expose: def.expose } : {}),
  });

  // load() and config() share one deserialize of the process-local stash.
  let resolved: Config | undefined;
  let loadedDeps: HydratedDeps<D> | undefined;
  let loadedParams: Values<P & ReservedParams> | undefined;
  let loadedSecrets: SecretValues<S> | undefined;
  function processConfig(): Config {
    if (resolved === undefined) resolved = deserialize(node, '');
    return resolved;
  }

  const runnable = {
    ...node,
    async run(address: string, boot: () => Promise<unknown>) {
      const config = deserialize(node, address);
      // Re-key THIS service's whole reserved namespace address-free, before
      // the typed re-stashes below: every reader downstream (config, secrets,
      // serve()'s accepted keys, the streams entrypoint's API_KEY) looks its
      // var up with no address, because one instance runs one service. Doing
      // it by prefix keeps this brand-blind — a landing's reserved name is the
      // registered landing's business (control.ts), never something compute
      // has to know (ADR-0031). Only this address's own vars move; the typed
      // stashes that follow overwrite anything they own, so they stay
      // authoritative for params and secret pointers.
      restashAddressFree(address);
      stash(node, config);
      // Re-emit the secret POINTERS address-free too, so secrets() double-looks-up
      // the same way with no address (the value stays only in its platform var).
      stashSecrets(node, address);
      // Expose the resolved service port under the near-universal PORT convention,
      // so a framework-unaware server (Next.js's standalone server.js binds the
      // PORT env var) listens on the port Compute routes to — not its own default.
      // A server that reads config().port explicitly (e.g. a Bun HTTP listener)
      // simply ignores it. Read the reserved `port` param the same way serialize
      // does (descriptors/compute.ts).
      const port = config.service['port'];
      if (typeof port === 'number') process.env['PORT'] = String(port);
      return boot();
    },
    load() {
      if (loadedDeps === undefined) {
        loadedDeps = blindCast<
          HydratedDeps<D>,
          'hydrateSync returns HydratedDeps<Deps>; for this node the deps are D'
        >(hydrateSync(node, processConfig()));
      }
      return loadedDeps;
    },
    config() {
      if (loadedParams === undefined) {
        loadedParams = blindCast<
          Values<P & ReservedParams>,
          'the deserialized service config record (untyped at runtime) is exactly the typed Values shape'
        >(processConfig().service);
      }
      return loadedParams;
    },
    secrets() {
      if (loadedSecrets === undefined) {
        // Double-lookup (address-free) → resolved strings → SecretBoxes (core).
        loadedSecrets = blindCast<
          SecretValues<S>,
          'hydrateSecrets boxes one string per declared slot; for this node the slots are S'
        >(hydrateSecrets(node, deserializeSecrets(node, '')));
      }
      return loadedSecrets;
    },
  };
  return Object.freeze(
    blindCast<
      RunnableServiceNode<D, P & ReservedParams, E, S>,
      "the spread copies node's own enumerable data (including the Symbol.for brand) and adds run/load/config/secrets — exactly RunnableServiceNode's shape"
    >(runnable),
  );
};
