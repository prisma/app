/**
 * Marks a service as a Next.js app for deployment. `nextjs({ module, appDir,
 * entry })`: `module` is the authoring module's `import.meta.url`; `appDir`
 * is the Next app's root (the standalone layout root), resolved relative to
 * `dirname(module)` — exactly like an import specifier (ADR-0004); `entry` is
 * the built standalone server's filename, relative to `appDir`'s standalone
 * output. Returns plain data — nothing runs on import.
 */
import type { BuildAdapter } from '@prisma/app';

/** The nextjs build adapter's descriptor — `appDir` is this kind's own extra path input, beyond the shared `{ kind, module, entry }`. */
export interface NextjsBuildAdapter extends BuildAdapter {
  readonly kind: 'nextjs';
  readonly appDir: string;
}

export default (opts: { module: string; appDir: string; entry: string }): NextjsBuildAdapter => ({
  kind: 'nextjs',
  pack: '@prisma/app-nextjs',
  module: opts.module,
  appDir: opts.appDir,
  entry: opts.entry,
});
