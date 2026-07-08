// App-owned build: bundle both the app's own entry (src/server.ts) and the
// MakerKit wrapper (src/service.ts) into one bundle dir, as two independent,
// self-contained runnables — each re-bundles service.ts on its own; run() and
// load() hand off state through process.env, not shared JS object identity, so
// the duplication is by design (see serializer.ts). MakerKit ships no build
// step, but it does own the artifact envelope — bootstrap.js +
// compute.manifest.json + the deterministic tar are printed by the pack's
// `package()` at deploy, not here.
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'tsdown';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const bundleDir = path.join(rootDir, 'dist', 'bundle');

// The app's own runnable (the build adapter's `entry`): @makerkit/* inlined so
// it needs nothing but `bun` — a Compute runtime built-in, unresolvable at
// bundle time.
await build({
  entry: { server: path.join(rootDir, 'src', 'server.ts') },
  outDir: bundleDir,
  format: 'esm',
  platform: 'node',
  external: ['bun'],
  noExternal: [/^@makerkit\//],
  dts: false,
  sourcemap: false,
  clean: true,
});

// The MakerKit wrapper (main.js): @makerkit/* inlined (node_modules is not
// shipped), `bun` external. The pack-printed bootstrap imports this and
// dynamically imports server.js.
await build({
  entry: { main: path.join(rootDir, 'src', 'service.ts') },
  outDir: bundleDir,
  format: 'esm',
  platform: 'node',
  external: ['bun'],
  noExternal: [/^@makerkit\//],
  dts: false,
  sourcemap: false,
  clean: false,
});

console.log(`Built ${bundleDir}`);
