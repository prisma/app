import { compute, http } from "@makerkit/prisma-cloud";

// Declared so the hex can wire it to the auth service and core computes +
// serializes its physical key (STOREFRONT_AUTH_URL — see app/page.tsx). This
// handler never touches the hydrated client: the Next page reads that key
// directly from process.env, bypassing hydrate/DI (the documented
// framework-DI gap — `use()` is out of scope for this slice).
const auth = http();

// Kept non-literal so neither tsc nor the bundler resolves it at build time;
// the artifact places the bundled main entry next to Next's server.js (see
// scripts/bundle-next.ts), so the relative specifier resolves inside the tar.
const serverModule = './server.js';

// No db input: nothing in the storefront queries its own database today (D3).
// Next reads PORT itself, so the service param is declared but unused here.
export default compute({ auth }, () => {
  // An unhandled error would otherwise crash the process into a 502 restart
  // loop on Compute; log and keep the process alive instead.
  process.on("uncaughtException", (err) => console.error("uncaughtException", err));
  process.on("unhandledRejection", (err) => console.error("unhandledRejection", err));

  return import(serverModule);
});
