/**
 * Marks a service as a Next.js app for deployment. `nextjs({ module })`:
 * `module` is the authoring module's `import.meta.url`, and the Next app root
 * (the folder with `next.config`, `.next/`, `public/`) defaults to that file's
 * own directory. Pass `appDir` — resolved relative to `dirname(module)`, like an
 * import specifier (ADR-0004) — only when the authoring file sits elsewhere
 * (e.g. a nested `src/`). Build it with `next build` (`output: "standalone"`);
 * the deploy assembler then does the documented standalone deploy — ships the
 * standalone tree and copies in the client assets (`.next/static`, `public/`) it
 * omits — so there is no build-script step and no path to spell out. Returns
 * plain data; nothing runs on import. `extension` + `type` are the control-plane
 * registry key: deploy tooling routes assembly through the app's
 * `prisma-compose.config.ts` to this package's `/control` descriptor (ADR-0017).
 */
import type { BuildAdapter } from '@internal/core';

/** The nextjs build adapter's descriptor — `appDir` is this kind's own extra path input (the Next app root), beyond the shared `{ extension, type, module, entry }`. `entry` is a placeholder; the assembler locates `server.js` in the standalone tree. */
export interface NextjsBuildAdapter extends BuildAdapter {
  readonly type: 'nextjs';
  readonly appDir: string;
}

const nextjsBuild = (opts: { module: string; appDir?: string }): NextjsBuildAdapter => ({
  extension: '@prisma/compose/nextjs',
  type: 'nextjs',
  module: opts.module,
  appDir: opts.appDir ?? '.',
  entry: 'server.js',
});

export default nextjsBuild;
