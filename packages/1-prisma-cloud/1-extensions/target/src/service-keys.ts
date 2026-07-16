/**
 * ADR-0030's per-binding service keys: the ONE accepted-keys env-var name,
 * shared by `control.ts` (which registers the provisioner that mints them and
 * the landing that writes this var — see its `serviceKeyLanding`) and
 * `@internal/rpc`'s `serve()` (which reads it), so writer and reader cannot
 * drift. Finding the edges themselves is `provisioned-edges.ts`'s generic,
 * brand-blind scan — RPC is not special-cased anywhere in this target.
 *
 * This module is reachable from the RUNTIME/authoring side — it must never
 * import `@internal/lowering` or `effect`, or those tokens leak into a user
 * service's bundle (the provisioner and landing live in control.ts, the
 * control-plane-only entry).
 */
import { configKey } from './serializer.ts';

/** The reserved accepted-keys env var: COMPOSER_<addr>_RPC_ACCEPTED_KEYS ("" ↦ @internal/rpc's RPC_ACCEPTED_KEYS_ENV). */
export const serviceKeyEnvName = (address: string): string =>
  configKey(address, { owner: 'service', name: 'RPC_ACCEPTED_KEYS' });
