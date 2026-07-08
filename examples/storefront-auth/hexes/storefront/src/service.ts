import nextjs from '@makerkit/nextjs';
import { compute, http } from '@makerkit/prisma-cloud';

// Declared so the hex can wire it to the auth service; core computes +
// serializes its physical key (STOREFRONT_AUTH_URL — see app/page.tsx, which
// pulls the hydrated client via service.load() rather than reading the key
// itself).
const auth = http();

// No db input: nothing in the storefront queries its own database today (D3).
// Next reads PORT itself, so the service param is declared but unused here.
// `entry` is Next's standalone server.js, at the root of the bundle dir (see
// scripts/bundle-next.ts's nextStandaloneDir).
export default compute({ deps: { auth }, build: nextjs({ entry: 'server.js' }) });
