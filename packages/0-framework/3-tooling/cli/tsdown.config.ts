import { baseConfig, defineConfig } from '@internal/tsdown-config';

// `bin.ts` is the executable target, not an importable module, so it stays at
// the `src/` root. The base `exclude: [/^bin$/]` keeps `bin` out of the
// generated exports map; `bin: false` additionally stops tsdown from
// auto-declaring a top-level `bin` field off bin.ts's shebang — this package is
// private and ships no executable (@prisma/composer publishes the CLI).
export default defineConfig({
  entry: { index: 'src/exports/index.ts', bin: 'src/bin.ts' },
  exports:
    typeof baseConfig.exports === 'object'
      ? { ...baseConfig.exports, bin: false }
      : baseConfig.exports,
});
