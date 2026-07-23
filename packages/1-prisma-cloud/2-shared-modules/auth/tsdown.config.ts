import { baseConfig } from '@internal/tsdown-config';
import { defineConfig } from 'tsdown';

// Mirrors email's multi-pass shape (email/tsdown.config.ts): index +
// auth-service in one pass at the dist root (authService resolves
// `./auth-service.mjs` from the code that calls it, via import.meta.url) plus
// the pack; the entrypoint/testing passes arrive with the code they build
// (D5). Hand-maintained `package.json#exports` per the exports-entrypoints
// rule's multi-pass exception.
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
]);
