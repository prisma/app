import { defineConfig } from '@internal/tsdown-config';

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    compute: 'src/exports/compute.ts',
    postgres: 'src/exports/postgres.ts',
    state: 'src/exports/state.ts',
  },
});
