import { baseConfig } from '@internal/tsdown-config';
import { defineConfig } from 'tsdown';

// Mirrors email's multi-pass shape (email/tsdown.config.ts): index +
// auth-service in one pass at the dist root (authService resolves
// `./auth-service.mjs` from the code that calls it, via import.meta.url)
// plus the pack; auth-entrypoint fully inlined and standing alone; testing
// (the local stand-in) in its own pass. `bun` stays external everywhere it's
// reached (a runtime builtin, ADR-0008); `@internal/`/`@prisma/`/`arktype`/
// `@standard-schema/`/`better-auth`/`jose`/`pg` are inlined so the
// entrypoint/testing bundles are otherwise self-contained. Hand-maintained
// `package.json#exports` per the exports-entrypoints rule's multi-pass
// exception.
export default defineConfig([
  {
    ...baseConfig,
    entry: {
      index: 'src/exports/index.ts',
      'auth-service': 'src/exports/auth-service.ts',
      pack: 'src/exports/pack.ts',
    },
    exports: false,
    clean: true,
  },
  {
    ...baseConfig,
    entry: { 'auth-entrypoint': 'src/exports/auth-entrypoint.ts' },
    exports: false,
    clean: false,
    skipNodeModulesBundle: false,
    // better-auth lazy-imports optional kysely dialects; without this the
    // bundle splits into sibling chunk files the deploy packager never
    // ships. One entry, one file.
    outputOptions: { inlineDynamicImports: true },
    external: [/^bun$/, /^bun:/],
    noExternal: [
      /^@internal\//,
      /^@prisma\//,
      /^arktype/,
      /^@standard-schema\//,
      /^better-auth/,
      /^@better-auth\//,
      /^jose/,
      /^pg/,
    ],
  },
  {
    ...baseConfig,
    entry: { testing: 'src/exports/testing.ts' },
    exports: false,
    clean: false,
    skipNodeModulesBundle: false,
    // Same single-file requirement as the entrypoint pass (see above).
    outputOptions: { inlineDynamicImports: true },
    external: [/^bun$/, /^bun:/],
    noExternal: [
      /^@internal\//,
      /^@prisma\//,
      /^arktype/,
      /^@standard-schema\//,
      /^better-auth/,
      /^@better-auth\//,
      /^jose/,
      /^pg/,
    ],
  },
]);
