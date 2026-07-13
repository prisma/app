// Next's `output: "standalone"` ships server.js + traced node_modules but omits
// the client assets (`.next/static`, `public/`). Prisma Compose deploys a flat,
// finished bundle and never completes the tree itself (ADR-0005), so this build
// copies the assets in. outputFileTracingRoot is the repo root (see
// next.config.ts), so the app is nested at that same relative path under
// `.next/standalone/`.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tracingRoot = path.resolve(appDir, '../../../..'); // must match next.config's outputFileTracingRoot
const appOut = path.join(appDir, '.next', 'standalone', path.relative(tracingRoot, appDir));

fs.cpSync(path.join(appDir, '.next', 'static'), path.join(appOut, '.next', 'static'), {
  recursive: true,
});
const publicDir = path.join(appDir, 'public');
if (fs.existsSync(publicDir)) {
  fs.cpSync(publicDir, path.join(appOut, 'public'), { recursive: true });
}
