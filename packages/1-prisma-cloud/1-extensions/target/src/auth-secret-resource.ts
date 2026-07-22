/**
 * The `AuthSecret` Alchemy resource — mints a random 32-byte secret ONCE at
 * create and keeps it STABLE across deploys, so an unchanged module no-ops on
 * redeploy. The secret is generated with the Web Crypto global
 * (`crypto.getRandomValues` — no `node:` import, matching this package's
 * runtime-coupling invariant) and persisted in Alchemy state; on every later
 * apply the provider returns the persisted attributes (`reconcile`'s `output`)
 * unchanged — the same way `S3Credentials` keeps its pair stable. Rotation is
 * destroy/recreate (unsupported in v1, documented in the auth module).
 *
 * Deploy-time only: imports `alchemy`. Imported by `control/extension.ts` and
 * tests, never by `index.ts` / the authoring entry.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';

/** No inputs — the secret is generated, not derived. */
export type AuthSecretProps = Record<never, never>;

export interface AuthSecretAttributes {
  readonly value: string;
}

export type AuthSecret = Resource<'PrismaCloud.AuthSecret', AuthSecretProps, AuthSecretAttributes>;

/** The `AuthSecret` resource constructor — `yield* AuthSecret(id, {})` in the lowering. */
export const AuthSecret = Resource<AuthSecret>('PrismaCloud.AuthSecret');

/** A fresh instance secret: 32 random bytes, base64. */
export function mintAuthSecret(): AuthSecretAttributes {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return { value: btoa(String.fromCharCode(...bytes)) };
}

/**
 * The `AuthSecret` provider service. `reconcile` runs for create and update;
 * it returns the persisted `output` when present (a redeploy reuses the stored
 * secret — the no-op property) and mints a fresh secret only on first create.
 * Nothing to enumerate (`list` → `[]`) or tear down (`delete` → no-op; the
 * secret lives only in state). Exported so tests can drive it directly.
 */
export const authSecretProviderService: Provider.ProviderService<AuthSecret> = {
  list: () => Effect.succeed([]),
  reconcile: ({ output }) => Effect.sync(() => output ?? mintAuthSecret()),
  delete: () => Effect.void,
};

/** The `AuthSecret` provider layer — merged into the extension descriptor's `providers()`. */
export const AuthSecretProvider = () =>
  Provider.effect(AuthSecret, Effect.succeed(authSecretProviderService));
