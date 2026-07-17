/**
 * A tiny job-log app that uses the streams module as its event log. The
 * `StreamsClient` arrives hydrated from the `durableStreams()` binding — URL,
 * bearer auth, append framing, offsets, and the long-poll dance are all the
 * client's business (like RPC's generated client), so what remains here is
 * app logic: routes, the stream name, and error mapping.
 *
 *   POST /jobs        append one event; body is the event JSON
 *   GET  /jobs        read the whole log back (optionally from ?offset=…)
 *   GET  /jobs/tail   wait for the next event after the current head
 *
 * `createJobsApp` returns a plain `Request → Response` handler so the same app
 * runs behind `Bun.serve` in the deployed service and inside the integration
 * test with no server.
 */
import type { StreamsClient } from '@prisma/composer-prisma-cloud/streams';

const STREAM = 'jobs';

export function createJobsApp(events: StreamsClient): (req: Request) => Promise<Response> {
  let created: Promise<void> | undefined;
  // Once per instance; the client's create is ensure-style, so a racing
  // second instance is harmless.
  const ensureStream = (): Promise<void> => {
    if (created === undefined) {
      created = events.create(STREAM).catch((error: unknown) => {
        created = undefined;
        throw error;
      });
    }
    return created;
  };

  const append = async (req: Request): Promise<Response> => {
    await ensureStream();
    const event = await req.json();
    // The client never retries appends (no idempotency key upstream — a
    // failed request is indistinguishable from one that applied). The caller
    // retries, because only it knows whether a duplicate is acceptable.
    await events.append(STREAM, event);
    return Response.json({ appended: event }, { status: 201 });
  };

  const read = async (url: URL): Promise<Response> => {
    await ensureStream();
    const offset = url.searchParams.get('offset') ?? undefined;
    const result = await events.read(STREAM, offset !== undefined ? { offset } : undefined);
    return Response.json({ events: result.events, nextOffset: result.nextOffset });
  };

  const tail = async (url: URL): Promise<Response> => {
    await ensureStream();
    const timeout = url.searchParams.get('timeout');
    const result = await events.tail(STREAM, {
      ...(timeout !== null ? { timeoutMs: Number(timeout) * 1000 } : {}),
    });
    return Response.json({ events: result.events, timedOut: result.timedOut });
  };

  const route = async (req: Request, url: URL): Promise<Response> => {
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response('jobs — POST /jobs, GET /jobs, GET /jobs/tail\n');
    }
    if (url.pathname === '/jobs/tail' && req.method === 'GET') return tail(url);
    if (url.pathname === '/jobs') {
      if (req.method === 'POST') return append(req);
      if (req.method === 'GET') return read(url);
      return new Response('method not allowed', { status: 405 });
    }
    return new Response('not found', { status: 404 });
  };

  return async (req: Request): Promise<Response> => {
    try {
      return await route(req, new URL(req.url));
    } catch (error) {
      // An unreachable dependency is this app's upstream problem, not the
      // caller's mistake: say so as 502, naming the cause, rather than letting
      // the throw become an opaque 500.
      console.error('jobs: request failed', error);
      return new Response(`streams unreachable: ${String(error)}`, { status: 502 });
    }
  };
}
