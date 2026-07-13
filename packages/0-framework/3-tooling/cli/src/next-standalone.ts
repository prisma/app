/**
 * `prisma-compose next-standalone` — makes a Next.js `output: "standalone"` tree
 * a complete, flat deploy bundle. Next omits the client assets (`.next/static`,
 * `public/`) from the standalone output; the framework never completes the tree
 * (ADR-0005), so the app runs this after `next build` to copy them in. The app
 * then points its `node({ dir, entry })` build at the standalone root.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** The app's own server.js inside the standalone tree — the shallowest one that isn't a dependency's. */
function findAppServer(standaloneRoot: string): string | undefined {
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.name === 'server.js') found.push(full);
    }
  };
  visit(standaloneRoot);
  found.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);
  return found[0];
}

/** Copies `.next/static` and `public/` into the standalone app dir. Idempotent; safe to re-run. */
export function prepareNextStandalone(appDir: string): void {
  const standaloneRoot = path.join(appDir, '.next', 'standalone');
  if (!fs.existsSync(standaloneRoot)) {
    throw new Error(
      `no .next/standalone under ${appDir} — run \`next build\` with output: "standalone" first.`,
    );
  }
  const server = findAppServer(standaloneRoot);
  if (server === undefined) {
    throw new Error(`no server.js found under ${standaloneRoot} — is this a standalone build?`);
  }
  const appOut = path.dirname(server);

  const staticSrc = path.join(appDir, '.next', 'static');
  if (fs.existsSync(staticSrc)) {
    fs.cpSync(staticSrc, path.join(appOut, '.next', 'static'), { recursive: true });
  }
  const publicSrc = path.join(appDir, 'public');
  if (fs.existsSync(publicSrc)) {
    fs.cpSync(publicSrc, path.join(appOut, 'public'), { recursive: true });
  }
  console.log(`next-standalone: copied client assets into ${path.relative(appDir, appOut)}`);
}
