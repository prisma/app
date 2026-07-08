// The Storefront calls the Auth service while serving the request — the
// ingress -> Auth path the MVP exercises. `auth` is the http() connection-end
// service.ts declares; service.load() hydrates it against STOREFRONT_AUTH_URL
// (address "storefront" ▸ owner (input) "auth" ▸ name "url" — see
// @makerkit/prisma-cloud's configKey), so the page pulls a real typed client
// rather than reading the physical env key itself.
import service from '../src/service.ts';

// Render on every request so the runtime-injected value is used — otherwise
// Next prerenders this page at build time, before it exists.
export const dynamic = 'force-dynamic';

async function getAuthStatus(): Promise<string> {
  const { auth } = service.load();
  try {
    const res = await auth.fetch('/verify');
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
