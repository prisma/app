/**
 * The `email()` module Loads into a wired graph: it owns a Postgres `db`
 * resource and the `email` service wired to it, forwards its boundary
 * `deliveryMode`/`from` params and `deliveryCredential` secret down to the
 * service, and its two ports (`send`, `outbox`) wire to two different
 * consumers independently. Mirrors storage's module.test.ts — this is the
 * first shipped module using boundary params (spec §"Module factory").
 */
import { describe, expect, test } from 'bun:test';
import { Load, module, paramSource, secretSource } from '@internal/core';
import node from '@internal/node';
import { compute } from '@internal/prisma-cloud';
import { rpc } from '@internal/service-rpc';
import { emailOutboxContract, emailSender } from '../contract.ts';
import { email } from '../email-module.ts';

const build = node({ module: import.meta.url, entry: '../dist/x.mjs' });

const senderConsumer = () =>
  compute({ name: 'sender-consumer', deps: { email: emailSender({}) }, build });
const outboxConsumer = () =>
  compute({ name: 'outbox-consumer', deps: { outbox: rpc(emailOutboxContract) }, build });

function rootWithEmail() {
  return module('root', {}, ({ provision }) => {
    provision(email(), {
      id: 'email',
      params: { deliveryMode: paramSource('EMAIL_DELIVERY_MODE'), from: paramSource('EMAIL_FROM') },
      secrets: { deliveryCredential: secretSource('EMAIL_DELIVERY_CREDENTIAL') },
    });
    return {};
  });
}

describe('email()', () => {
  test('Loads the db resource and the email service, wired to each other', () => {
    const graph = Load(rootWithEmail());
    const byId = new Map(graph.nodes.map((n) => [n.id, n.node]));
    const typeOf = (id: string): string | undefined => {
      const n = byId.get(id);
      return n !== undefined && 'type' in n ? n.type : undefined;
    };

    expect(typeOf('email.db')).toBe('postgres');
    expect(typeOf('email.service')).toBe('compute');
    expect(graph.edges).toContainEqual({
      from: 'email.db',
      to: 'email.service',
      input: 'db',
      kind: 'dependency',
    });
  });

  test('the db resource is not exposed to a consumer — only send/outbox are', () => {
    const graph = Load(rootWithEmail());
    // No edge targets anything outside "email.*" from "email.db" directly —
    // the only consumer of the db is the service itself.
    const dbEdges = graph.edges.filter((e) => e.from === 'email.db');
    expect(dbEdges).toEqual([
      { from: 'email.db', to: 'email.service', input: 'db', kind: 'dependency' },
    ]);
  });

  test('boundary params forward: deliveryMode/from reach the service as bound param sources', () => {
    const graph = Load(rootWithEmail());
    const forwarded = graph.params.filter((p) => p.serviceAddress === 'email.service');
    const slots = forwarded.map((p) => p.slot).sort();
    expect(slots).toEqual(['deliveryMode', 'from']);
  });

  test('the boundary secret forwards: deliveryCredential reaches the service', () => {
    const graph = Load(rootWithEmail());
    const forwarded = graph.secrets.filter((s) => s.serviceAddress === 'email.service');
    expect(forwarded.map((s) => s.slot)).toEqual(['deliveryCredential']);
  });

  test('the send port resolves to the service for a sender consumer', () => {
    const root = module('root', {}, ({ provision }) => {
      const mail = provision(email(), {
        id: 'email',
        params: {
          deliveryMode: paramSource('EMAIL_DELIVERY_MODE'),
          from: paramSource('EMAIL_FROM'),
        },
        secrets: { deliveryCredential: secretSource('EMAIL_DELIVERY_CREDENTIAL') },
      });
      provision(senderConsumer(), { id: 'sender', deps: { email: mail.send } });
      return {};
    });

    const graph = Load(root);
    expect(graph.edges).toContainEqual({
      from: 'email.service',
      to: 'sender',
      input: 'email',
      kind: 'dependency',
    });
  });

  test('the outbox port resolves to the service for a different consumer, independent of send', () => {
    const root = module('root', {}, ({ provision }) => {
      const mail = provision(email(), {
        id: 'email',
        params: {
          deliveryMode: paramSource('EMAIL_DELIVERY_MODE'),
          from: paramSource('EMAIL_FROM'),
        },
        secrets: { deliveryCredential: secretSource('EMAIL_DELIVERY_CREDENTIAL') },
      });
      provision(senderConsumer(), { id: 'sender', deps: { email: mail.send } });
      provision(outboxConsumer(), { id: 'reader', deps: { outbox: mail.outbox } });
      return {};
    });

    const graph = Load(root);
    expect(graph.edges).toContainEqual({
      from: 'email.service',
      to: 'sender',
      input: 'email',
      kind: 'dependency',
    });
    expect(graph.edges).toContainEqual({
      from: 'email.service',
      to: 'reader',
      input: 'outbox',
      kind: 'dependency',
    });
  });

  test('opts.name customizes the module id', () => {
    const root = module('root', {}, ({ provision }) => {
      provision(email({ name: 'mail' }), {
        id: 'mail',
        params: {
          deliveryMode: paramSource('EMAIL_DELIVERY_MODE'),
          from: paramSource('EMAIL_FROM'),
        },
        secrets: { deliveryCredential: secretSource('EMAIL_DELIVERY_CREDENTIAL') },
      });
      return {};
    });

    const graph = Load(root);
    const byId = new Map(graph.nodes.map((n) => [n.id, n.node]));
    expect([...byId.keys()]).toContain('mail.service');
    expect([...byId.keys()]).toContain('mail.db');
  });
});
