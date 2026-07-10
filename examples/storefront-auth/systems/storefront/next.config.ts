import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// The monorepo root: standalone file tracing must start here, or Next walks up
// to the outer checkout's lockfile and traces the wrong node_modules.
const workspaceRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

// Standalone output is what Prisma Compute deploys — a self-contained server.js
// plus the minimal node_modules, not a `next start` dev server.
const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot,
  images: { unoptimized: true },
  // Next traces native binaries (`sharp` for image optimization, `@next/swc`)
  // into the standalone, built for THIS machine's platform (darwin). The app
  // uses neither at runtime, but on Compute's linux VM their linux variants are
  // missing, so `bun` auto-installs them at boot and fills the tiny disk
  // (ENOSPC crash loop). Exclude them from the trace — the proper Next knob,
  // rather than deleting them from the assembled tree afterwards.
  outputFileTracingExcludes: {
    '*': ['**/node_modules/@next/swc-*/**', '**/node_modules/sharp/**', '**/node_modules/@img/**'],
  },
};

export default nextConfig;
