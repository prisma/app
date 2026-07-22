/**
 * `startLocalEmailServer` round-trips a real RPC call: a `makeClient` over
 * `emailSendContract` sends an email, then a `makeClient` over
 * `emailOutboxContract` reads it back by id and via `listEmails` — proving
 * the local stand-in actually serves both ports, mode `none`, no auth.
 * Also exercises `emailSender(templates)`'s hydrated client against the same
 * stand-in, proving explicit `undefined` optionals behave exactly like
 * absent ones on the wire (spec's `EmailSender` amendment, 2026-07-22).
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { makeClient } from '@internal/service-rpc';
import { type } from 'arktype';
import {
  defineTemplates,
  emailOutboxContract,
  emailSendContract,
  emailSender,
} from '../contract.ts';
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

  test('emailSender: explicit undefined optionals are omitted from the wire payload, same as absent', async () => {
    server = await startLocalEmailServer();
    const templates = defineTemplates({
      welcome: {
        data: type({ name: 'string' }),
        render: ({ name }) => ({ subject: `Hi ${name}`, html: `<p>Hi ${name}</p>` }),
      },
    });
    const sender = await emailSender(templates).connection.hydrate({ url: server.url });

    const result = await sender.welcome({
      to: 'user@example.com',
      data: { name: 'Ada' },
      cc: undefined,
      bcc: undefined,
      replyTo: undefined,
      idempotencyKey: undefined,
    });

    const outboxClient = makeClient(emailOutboxContract, server.url);
    const { email } = await outboxClient.getEmail({ id: result.id });
    expect(email?.cc).toEqual([]);
    expect(email?.bcc).toEqual([]);
    expect(email?.replyTo).toBeNull();
  });
});
