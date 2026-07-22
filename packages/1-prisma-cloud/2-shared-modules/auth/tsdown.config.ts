import { baseConfig } from '@internal/tsdown-config';
import { defineConfig } from 'tsdown';

// Mirrors email's multi-pass shape (email/tsdown.config.ts). D3 ships only the
// authoring index (still empty — the surface arrives with the module code) and
// the pack; the service/entrypoint/testing passes arrive with the code they
// build. Hand-maintained `package.json#exports` per the exports-entrypoints
// rule's multi-pass exception.
export default defineConfig([
  {
    ...baseConfig,
    entry: { index: 'src/exports/index.ts', pack: 'src/exports/pack.ts' },
    exports: false,
    clean: true,
  },
]);
