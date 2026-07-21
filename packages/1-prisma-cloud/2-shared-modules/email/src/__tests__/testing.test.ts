/**
 * `startLocalEmailServer` round-trips a real RPC call: a `makeClient` over
 * `emailSendContract` sends an email, then a `makeClient` over
 * `emailOutboxContract` reads it back by id and via `listEmails` — proving
 * the local stand-in actually serves both ports, mode `none`, no auth.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { makeClient } from '@internal/service-rpc';
import { emailOutboxContract, emailSendContract } from '../contract.ts';
import { type LocalEmailServer, startLocalEmailServer } from '../execution/testing.ts';

let server: LocalEmailServer | undefined;
afterEach(async () => {
  await server?.stop();
  server = undefined;
});

describe('startLocalEmailServer', () => {
  test('send then getEmail/listEmails round-trip over real RPC clients', async () => {
    server = await startLocalEmailServer();
    const sendClient = makeClient(emailSendContract, server.url);
    const outboxClient = makeClient(emailOutboxContract, server.url);

    const sent = await sendClient.send({
      templateId: 'welcome',
      to: ['user@example.com'],
      subject: 'Hi',
      html: '<p>hi</p>',
      idempotencyKey: crypto.randomUUID(),
    });
    expect(sent.status).toBe('stored');

    const { email } = await outboxClient.getEmail({ id: sent.id });
    expect(email?.id).toBe(sent.id);
    expect(email?.subject).toBe('Hi');
    expect(email?.status).toBe('stored');

    const { emails } = await outboxClient.listEmails({});
    expect(emails.map((e) => e.id)).toContain(sent.id);
  });

  test('honors an explicit port', async () => {
    server = await startLocalEmailServer({ port: 0 });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});
