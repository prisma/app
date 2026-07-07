// The Storefront calls the Auth service while serving the request — the
// ingress -> Auth path the MVP exercises. STOREFRONT_AUTH_URL is the auth
// connection's PHYSICAL key: address "storefront" ▸ owner (input) "auth" ▸
// name "url" → STOREFRONT_AUTH_URL (see @makerkit/prisma-cloud's configKey).
// Reading it directly here — rather than through the hydrated `auth` client
// service.ts declares — is the documented framework-DI gap: there is no
// `use()` yet to pull a hydrated connection into a Next Server Component: R4
// scope is the address/config plumbing, not that DI primitive.

// Render on every request so the runtime-injected value is used — otherwise
// Next prerenders this page at build time, before it exists.
export const dynamic = "force-dynamic";

async function getAuthStatus(): Promise<string> {
  const base = process.env.STOREFRONT_AUTH_URL;
  if (!base) return "STOREFRONT_AUTH_URL not set";
  try {
    const res = await fetch(new URL('/verify', base), { cache: 'no-store' });
    return `${res.status} ${(await res.text()).trim()}`;
  } catch (err) {
    return `auth call failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export default async function Home() {
  const auth = await getAuthStatus();
  return (
    <main>
      <h1>Storefront</h1>
      <p>Auth /verify says: {auth}</p>
    </main>
  );
}
