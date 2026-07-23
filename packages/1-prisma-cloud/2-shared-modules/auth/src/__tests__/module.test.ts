/**
 * The `auth()` module Loads into a wired graph: the db AND the email sender
 * are BOUNDARY deps the root supplies (dedicated vs shared db, and which
 * email module instance, are the root's call), the instance secret is the
 * service's ordinary slot bound to `mintedSecret()` inside the factory
 * (consumers see no secret slot), the `baseUrl` boundary param forwards
 * down, and the three ports wire to consumers independently
 * (least-privilege by wiring).
 */
import { describe, expect, test } from 'bun:test';
import { isParamSource, Load, module, paramSource } from '@internal/core';
import { emailSendContract } from '@internal/email';
import node from '@internal/node';
import { compute, isMintedSecretBinding } from '@internal/prisma-cloud';
import { pnContract, pnPostgres } from '@internal/prisma-cloud/prisma-next';
import { rpc } from '@internal/service-rpc';
import { auth } from '../auth-module.ts';
import { authAdminContract, authApi, authSessionContract, jwtVerifier } from '../contract.ts';
import packContractJson from '../pack/contract.json' with { type: 'json' };

const build = node({ module: import.meta.url, entry: '../dist/x.mjs' });

/** A pack-carrying database node — what a root wires into the module's db slot. */
const database = () =>
  pnPostgres({
    name: 'database',
    contract: pnContract(packContractJson),
    config: './prisma-next.config.ts',
  });

/** A minimal provider of the `email` boundary dep — exposes only `send`, satisfying `emailSender(authTemplates)`'s required contract. */
const mailProvider = () =>
  compute({ name: 'mailProvider', deps: {}, build, expose: { send: emailSendContract } });

const apiConsumer = () =>
  compute({ name: 'apiConsumer', deps: { authApi: authApi(), verifier: jwtVerifier() }, build });
const sessionConsumer = () =>
  compute({ name: 'sessionConsumer', deps: { session: rpc(authSessionContract) }, build });
const opsConsumer = () =>
  compute({ name: 'opsConsumer', deps: { admin: rpc(authAdminContract) }, build });

function rootWithAuth() {
  return module('root', {}, ({ provision }) => {
    const db = provision(database(), { id: 'database' });
    const mail = provision(mailProvider(), { id: 'mail' });
    const authRef = provision(auth(), {
      id: 'auth',
      deps: { db, email: mail.send },
      params: { baseUrl: paramSource('AUTH_BASE_URL') },
    });
    provision(apiConsumer(), { id: 'app', deps: { authApi: authRef.api, verifier: authRef.api } });
    provision(sessionConsumer(), { id: 'profile', deps: { session: authRef.session } });
    provision(opsConsumer(), { id: 'ops', deps: { admin: authRef.admin } });
    return {};
  });
}

describe('auth()', () => {
  test('Loads the service with a minted secret slot; db and email stay boundary deps wired through', () => {
    const graph = Load(rootWithAuth());
    const byId = new Map(graph.nodes.map((n) => [n.id, n.node]));
    const typeOf = (id: string): string | undefined => {
      const n = byId.get(id);
      return n !== undefined && 'type' in n ? n.type : undefined;
    };

    expect(typeOf('auth.service')).toBe('compute');
    // The database and the mail provider are the ROOT's nodes — the module
    // provisions no db or email service of its own.
    expect(typeOf('database')).toBe('prisma-next');
    expect(typeOf('mail')).toBe('compute');
    expect(graph.edges).toContainEqual({
      from: 'database',
      to: 'auth.service',
      input: 'db',
      kind: 'dependency',
    });
    expect(graph.edges).toContainEqual({
      from: 'mail',
      to: 'auth.service',
      input: 'email',
      kind: 'dependency',
    });
    // The instance secret is the service's ordinary slot, bound to
    // mintedSecret() by the factory — no dedicated secret node exists.
    const binding = graph.secrets.find(
      (b) => b.serviceAddress === 'auth.service' && b.slot === 'secret',
    );
    expect(binding).toBeDefined();
    expect(isMintedSecretBinding(binding!)).toBe(true);
  });

  test('forwards the baseUrl boundary param down to the service', () => {
    const graph = Load(rootWithAuth());
    const binding = graph.params.find(
      (p) => p.serviceAddress === 'auth.service' && p.slot === 'baseUrl',
    );
    expect(binding).toBeDefined();
    expect(isParamSource(binding?.binding)).toBe(true);
  });

  test('the three ports wire to three consumers independently', () => {
    const graph = Load(rootWithAuth());
    expect(graph.edges).toContainEqual({
      from: 'auth.service',
      to: 'app',
      input: 'authApi',
      kind: 'dependency',
    });
    expect(graph.edges).toContainEqual({
      from: 'auth.service',
      to: 'app',
      input: 'verifier',
      kind: 'dependency',
    });
    expect(graph.edges).toContainEqual({
      from: 'auth.service',
      to: 'profile',
      input: 'session',
      kind: 'dependency',
    });
    expect(graph.edges).toContainEqual({
      from: 'auth.service',
      to: 'ops',
      input: 'admin',
      kind: 'dependency',
    });
  });

  test('a custom name scopes the internal ids', () => {
    const graph = Load(
      module('root', {}, ({ provision }) => {
        const db = provision(database(), { id: 'database' });
        const mail = provision(mailProvider(), { id: 'mail' });
        provision(auth({ name: 'identity' }), {
          id: 'identity',
          deps: { db, email: mail.send },
          params: { baseUrl: paramSource('AUTH_BASE_URL') },
        });
        return {};
      }),
    );
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain('identity.service');
    expect(
      graph.secrets.some((b) => b.serviceAddress === 'identity.service' && b.slot === 'secret'),
    ).toBe(true);
  });
});
