/**
 * The streams client against the local stand-in: every method a consumer's
 * hydrated binding exposes, driven over the real protocol — create (and its
 * ensure semantics on a second create), JSON append framing, read from the
 * beginning and from an opaque mid-stream cursor, and a long-poll tail that
 * delivers an event appended after it opened (and times out cleanly when
 * nothing arrives). The stand-in has no auth, so the bearer header the client
 * always sends is simply ignored.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStreamsClient, type StreamsClient } from '../client.ts';
import { type LocalStreamsServer, startLocalStreamsServer } from '../testing.ts';

let server: LocalStreamsServer;
let client: StreamsClient;
let dataRoot: string;
let prevDataRoot: string | undefined;

beforeAll(async () => {
  dataRoot = mkdtempSync(join(tmpdir(), 'streams-client-test-'));
  prevDataRoot = process.env['DS_LOCAL_DATA_ROOT'];
  process.env['DS_LOCAL_DATA_ROOT'] = dataRoot;
  server = await startLocalStreamsServer({ name: 'streams-client-test', port: 0 });
  client = createStreamsClient({
    url: server.exports.http.url,
    apiKey: 'local-stand-in-needs-no-auth',
  });
});

afterAll(async () => {
  await server?.close();
  if (prevDataRoot === undefined) delete process.env['DS_LOCAL_DATA_ROOT'];
  else process.env['DS_LOCAL_DATA_ROOT'] = prevDataRoot;
  rmSync(dataRoot, { recursive: true, force: true });
});

describe('createStreamsClient (against the local stand-in)', () => {
  test('create is ensure-style: a second create of the same stream succeeds', async () => {
    await client.create('log');
    await client.create('log');
  });

  test('append then read round-trips events, and a mid-stream cursor resumes correctly', async () => {
    await client.append('log', { n: 1 });

    const first = await client.read('log');
    expect(first.events).toEqual([{ n: 1 }]);
    expect(first.nextOffset).not.toBe('');

    await client.append('log', { n: 2 });
    await client.append('log', { n: 3 });

    const all = await client.read('log');
    expect(all.events).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);

    const rest = await client.read('log', { offset: first.nextOffset });
    expect(rest.events).toEqual([{ n: 2 }, { n: 3 }]);
  });

  test('tail delivers an event appended after it opened', async () => {
    await client.create('live');
    const tail = client.tail('live', { timeoutMs: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    await client.append('live', { kind: 'ping' });

    const result = await tail;
    expect(result.timedOut).toBe(false);
    expect(result.events).toEqual([{ kind: 'ping' }]);
  }, 15_000);

  test('tail times out cleanly when nothing arrives', async () => {
    await client.create('quiet');
    const result = await client.tail('quiet', { timeoutMs: 1_000 });
    expect(result.timedOut).toBe(true);
    expect(result.events).toEqual([]);
  }, 10_000);

  test('a real protocol error surfaces immediately (read of a missing stream)', async () => {
    expect(client.read('never-created')).rejects.toThrow();
  });
});
