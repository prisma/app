// App-owned build: bundle the runtime entry. MakerKit ships no build step,
// but it does own the artifact envelope — bootstrap.js + compute.manifest.json
// + the deterministic tar are printed by the pack's `package()` at deploy,
// not here.
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "tsdown";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const bundleDir = path.join(rootDir, "dist", "bundle");

await build({
  entry: [path.join(rootDir, 'src', 'main.ts')],
  outDir: bundleDir,
  format: 'esm',
  platform: 'node',
  // "bun" is a runtime built-in on Compute — unresolvable at bundle time.
  external: ['bun'],
  // Workspace packages and hono must be inlined: node_modules is not shipped.
  noExternal: [/^@makerkit\//, /^hono/],
  dts: false,
  sourcemap: false,
  clean: true,
});

console.log(`Built ${bundleDir}`);
