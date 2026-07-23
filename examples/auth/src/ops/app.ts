/**
 * The ops service's request handling — a minimal admin passthrough proving
 * the admin port wires to a SECOND service (least-privilege by wiring):
 *
 *   /admin/find-user             → POST { email } → findUser
 *   /admin/revoke-user-sessions  → POST { userId } → revokeUserSessions
 *   /health                      → 200
 */

export interface AdminPort {
  findUser(input: { email: string }): Promise<{ user: { id: string; email: string } | null }>;
  revokeUserSessions(input: { userId: string }): Promise<{ revokedCount: number }>;
}

export function createOpsApp(deps: { admin: AdminPort }): (request: Request) => Promise<Response> {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  return async (request) => {
    const { pathname } = new URL(request.url);

    if (pathname === '/admin/find-user' && request.method === 'POST') {
      const body: unknown = await request.json();
      const email =
        typeof body === 'object' &&
        body !== null &&
        'email' in body &&
        typeof body.email === 'string'
          ? body.email
          : undefined;
      if (email === undefined) return json({ error: 'email required' }, 400);
      return json(await deps.admin.findUser({ email }));
    }

    if (pathname === '/admin/revoke-user-sessions' && request.method === 'POST') {
      const body: unknown = await request.json();
      const userId =
        typeof body === 'object' &&
        body !== null &&
        'userId' in body &&
        typeof body.userId === 'string'
          ? body.userId
          : undefined;
      if (userId === undefined) return json({ error: 'userId required' }, 400);
      return json(await deps.admin.revokeUserSessions({ userId }));
    }

    if (pathname === '/health') return json({ ok: true });
    return json({ error: 'not found' }, 404);
  };
}
