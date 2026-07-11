/**
 * The two testing seams (testing.md): `stubLoad` replaces a service node's
 * `load()` output (unit); `bootstrapService` feeds `load()`'s input by
 * booting the real entry against a chosen Config (integration). Both are
 * target-agnostic — `stubLoad` because every service node has a `load()`,
 * `bootstrapService` because it drives a target-supplied `runForTest`
 * capability rather than knowing any target's environment encoding itself.
 * Neither does module mocking; wiring a substitution into a test runner
 * (`vi.mock`, `mock.module`) stays in the test.
 */
import { blindCast } from './casts.ts';
import type { Config, Params, Values } from './config.ts';
import type { Deps, Expose, HydratedDeps, Loaded, RunnableServiceNode } from './node.ts';

/**
 * `stubLoad`'s override argument: every declared dependency, typed against
 * its own hydrated shape (`Client<C>` for an RPC dep, the resource binding
 * for a resource dep) — a double of the wrong shape is a compile error. The
 * service's own params are optional; an omitted one falls back to its
 * declared default, same as a real `load()`.
 */
export type LoadOverrides<D extends Deps, P extends Params> = HydratedDeps<D> & Partial<Values<P>>;

function paramDefaults<P extends Params>(params: P): Partial<Values<P>> {
  const defaults: Record<string, unknown> = {};
  for (const [name, param] of Object.entries(params)) {
    if (param.default !== undefined) defaults[name] = param.default;
  }
  return blindCast<
    Partial<Values<P>>,
    "assembled from each param declaration's own default value, one key per param that declares one — exactly Partial<Values<P>> by construction"
  >(defaults);
}

/**
 * Returns a service node whose `load()` yields `overrides` merged with the
 * service's own param defaults — everything else about the node (its deps,
 * params, build, expose) is unchanged. `run()` is not meaningful on a stub
 * (there is no boot, no environment) and throws if called.
 */
export function stubLoad<D extends Deps, P extends Params, E extends Expose>(
  service: RunnableServiceNode<D, P, E>,
  overrides: LoadOverrides<D, P>,
): RunnableServiceNode<D, P, E> {
  const loaded = blindCast<
    Loaded<D, P>,
    'merges the param defaults with the caller-supplied overrides, which LoadOverrides<D, P> already types against HydratedDeps<D> & Partial<Values<P>> — exactly Loaded<D, P> once params are filled in'
  >({ ...paramDefaults(service.params), ...overrides });

  return Object.freeze({
    ...service,
    run(): Promise<unknown> {
      throw new Error(
        `stubLoad(): "${service.name}" is a load()-only stub — it has no run() (no boot, no environment).`,
      );
    },
    load: () => loaded,
  });
}

/**
 * The in-process test capability a target's runnable node adds alongside
 * `run`/`load`: write a caller-chosen Config to the environment (exactly as
 * `run` does, minus the address→Config deserialize step) and call `boot()`.
 * Implemented once per target (e.g. `@prisma/app-cloud`'s `compute()`); a
 * structural interface, not a core node shape, so core names it without
 * depending on any target.
 */
export interface Testable {
  runForTest<T>(config: Config, boot: () => Promise<T>): Promise<T>;
}

/** What `bootstrapService` hands back: a live, driveable instance of the booted entry. */
export interface BootstrappedService {
  readonly url: string;
  readonly fetch: typeof fetch;
}

/**
 * The in-process counterpart of the deploy bootstrap (testing.md § Integration):
 * writes `config` into the environment via the target's `runForTest`, then
 * imports the app's real entry — `service.build.entry`, resolved relative to
 * `service.build.module`, exactly how the printed deploy bootstrap imports it
 * (see `@prisma/alchemy`'s artifact.ts). The entry's own top-level code is
 * what starts listening (the compute service's `server.ts`, unmodified);
 * `config.service.port` is required and concrete because the entry never
 * reports an OS-assigned port back to the caller. No `close()` — teardown
 * rides bun-test's per-file process isolation (H3's resolved decision).
 */
export async function bootstrapService<D extends Deps, P extends Params, E extends Expose>(
  service: RunnableServiceNode<D, P, E> & Testable,
  config: Config,
): Promise<BootstrappedService> {
  const port = config.service['port'];
  if (typeof port !== 'number') {
    throw new Error(
      'bootstrapService(): config.service.port must be a concrete port number — the booted entry ' +
        'self-listens with no way to report an OS-assigned one back to the caller.',
    );
  }
  const url = `http://localhost:${port}/`;
  const entryUrl = new URL(service.build.entry, service.build.module).href;

  return service.runForTest(config, async () => {
    await import(entryUrl);
    return { url, fetch };
  });
}
