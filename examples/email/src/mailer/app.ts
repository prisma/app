/**
 * The mailer example app: a signup story, not an HTTP proxy over the email
 * module's operations. `POST /signup` sends a verification email as part of
 * a real business action; following its link (`GET /verify`) completes the
 * story and sends a welcome email. `createEmailApp` returns a plain handler
 * so the same app runs behind `Bun.serve` in the deployed service and
 * inside the integration test with no server (mirrors the storage
 * example's `createBlobApp`).
 *
 *   POST /signup           { "email", "name" } — sends the verification email, responds with its send id
 *   GET  /verify?token=…   marks the user verified, sends the welcome email, responds with its send id
 *   GET  /emails/:id       demo-only read-by-id through the outbox — a real app guards or omits this
 *
 * This surface is deliberately unauthenticated, for the smoke's simplicity
 * — a real app must protect anything that can read the outbox (`GET
 * /emails/:id` especially), since stored bodies contain live links.
 */
import type { Client } from '@prisma/composer/service-rpc';
import type { EmailSender, emailOutboxContract } from '@prisma/composer-prisma-cloud/email';
import { type } from 'arktype';
import type { templates } from './templates.ts';

type Templates = typeof templates;
type Outbox = Client<typeof emailOutboxContract>;

const signupBody = type({ email: 'string', name: 'string' });

interface PendingUser {
  readonly email: string;
  readonly name: string;
  verified: boolean;
}

export function createEmailApp(
  email: EmailSender<Templates>,
  outbox: Outbox,
): (req: Request) => Promise<Response> {
  const usersByToken = new Map<string, PendingUser>();

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    if (req.method === 'POST' && url.pathname === '/signup') {
      const body = signupBody(await req.json().catch(() => undefined));
      if (body instanceof type.errors) {
        return Response.json({ error: body.summary }, { status: 400 });
      }
      const token = crypto.randomUUID();
      usersByToken.set(token, { email: body.email, name: body.name, verified: false });
      const link = `${url.origin}/verify?token=${token}`;
      const sent = await email.verification({ to: body.email, data: { link } });
      return Response.json({ id: sent.id }, { status: 201 });
    }

    if (req.method === 'GET' && url.pathname === '/verify') {
      const token = url.searchParams.get('token');
      const user = token !== null ? usersByToken.get(token) : undefined;
      if (user === undefined) return new Response('unknown or expired token', { status: 404 });
      user.verified = true;
      const sent = await email.welcome({ to: user.email, data: { name: user.name } });
      return Response.json({ verified: true, id: sent.id });
    }

    // Demo-only: a real app guards or omits a raw read-by-id — it can surface
    // any stored body, including a live verification link.
    if (req.method === 'GET' && url.pathname.startsWith('/emails/')) {
      const id = decodeURIComponent(url.pathname.slice('/emails/'.length));
      if (id.length === 0) return new Response('missing id', { status: 400 });
      const { email: record } = await outbox.getEmail({ id });
      if (record === null) return new Response('not found', { status: 404 });
      return Response.json(record);
    }

    return new Response('not found', { status: 404 });
  };
}
