import { defineConfig } from '@internal/tsdown-config';

// `compose-fetch` is a first-party-only subpath (the `@internal/prisma-cloud/
// connection` shape): the root barrel does not re-export it, so it never
// reaches `@prisma/composer/service-rpc` and never ships on the published API.
export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    'compose-fetch': 'src/exports/compose-fetch.ts',
  },
});
