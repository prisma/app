/**
 * The S3 wire-protocol engine (spec § 2): a pure `Request` → `Response`
 * handler over an `ObjectStore`. Path-style routing only; the bucket in the
 * path is the store's namespace (any bucket name is accepted). Every request is
 * SigV4-verified first; a failure is 403. No server framework — D3 wires this
 * into `Bun.serve`.
 *
 * Runtime engine code; NOT re-exported from the authoring barrel.
 */
import type { Credentials } from './sigv4.ts';
import { verifyRequest } from './sigv4.ts';
import type { GetRange, ObjectStore } from './store.ts';

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

export interface S3HandlerOptions {
  readonly store: ObjectStore;
  readonly credentials: Credentials;
}

interface Target {
  readonly bucket: string;
  readonly key: string;
}

/** Path-style: `/{bucket}/{key…}`. Each segment is percent-decoded. */
function parseTarget(url: URL): Target | null {
  const segments = url.pathname.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  const [bucket, ...keyParts] = segments;
  return {
    bucket: decodeURIComponent(bucket ?? ''),
    key: keyParts.map(decodeURIComponent).join('/'),
  };
}

/** `bytes=a-b` (inclusive) or `bytes=a-` (open-ended). Null when absent/malformed. */
function parseRange(header: string | null): GetRange | null {
  if (!header) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const start = Number(match[1]);
  return match[2] ? { start, end: Number(match[2]) } : { start };
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function listXml(
  bucket: string,
  prefix: string,
  maxKeys: number,
  result: { keys: readonly string[]; isTruncated: boolean; nextContinuationToken?: string },
): string {
  const contents = result.keys
    .map((k) => `<Contents><Key>${xmlEscape(k)}</Key></Contents>`)
    .join('');
  const next =
    result.isTruncated && result.nextContinuationToken !== undefined
      ? `<NextContinuationToken>${xmlEscape(result.nextContinuationToken)}</NextContinuationToken>`
      : '';
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">' +
    `<Name>${xmlEscape(bucket)}</Name>` +
    `<Prefix>${xmlEscape(prefix)}</Prefix>` +
    `<KeyCount>${result.keys.length}</KeyCount>` +
    `<MaxKeys>${maxKeys}</MaxKeys>` +
    `<IsTruncated>${result.isTruncated}</IsTruncated>` +
    contents +
    next +
    '</ListBucketResult>'
  );
}

const DEFAULT_MAX_KEYS = 1000;

async function handleList(store: ObjectStore, bucket: string, url: URL): Promise<Response> {
  const prefix = url.searchParams.get('prefix') ?? '';
  const continuationToken = url.searchParams.get('continuation-token');
  const maxKeysRaw = url.searchParams.get('max-keys');
  const maxKeys =
    maxKeysRaw !== null && Number.isFinite(Number(maxKeysRaw))
      ? Number(maxKeysRaw)
      : DEFAULT_MAX_KEYS;
  const result = await store.list(bucket, {
    prefix,
    maxKeys,
    ...(continuationToken !== null ? { continuationToken } : {}),
  });
  return new Response(listXml(bucket, prefix, maxKeys, result), {
    status: 200,
    headers: { 'content-type': 'application/xml' },
  });
}

async function handlePut(store: ObjectStore, t: Target, req: Request): Promise<Response> {
  const body = new Uint8Array(await req.arrayBuffer());
  const contentType = req.headers.get('content-type') ?? DEFAULT_CONTENT_TYPE;
  const { etag } = await store.put(t.bucket, t.key, body, { contentType });
  return new Response(null, { status: 200, headers: { etag } });
}

async function handleGet(store: ObjectStore, t: Target, req: Request): Promise<Response> {
  const range = parseRange(req.headers.get('range'));
  const object = await store.get(t.bucket, t.key, range ? { range } : undefined);
  if (!object) return new Response(null, { status: 404 });

  const headers = new Headers({
    etag: object.etag,
    'content-type': object.contentType,
    'content-length': String(object.bytes.byteLength),
    'accept-ranges': 'bytes',
  });
  if (!range) return new Response(object.bytes, { status: 200, headers });

  if (range.start >= object.size && object.size > 0) {
    return new Response(null, {
      status: 416,
      headers: { 'content-range': `bytes */${object.size}` },
    });
  }
  const end = range.end === undefined ? object.size - 1 : Math.min(range.end, object.size - 1);
  headers.set('content-range', `bytes ${range.start}-${end}/${object.size}`);
  return new Response(object.bytes, { status: 206, headers });
}

async function handleHead(store: ObjectStore, t: Target): Promise<Response> {
  const meta = await store.head(t.bucket, t.key);
  if (!meta) return new Response(null, { status: 404 });
  return new Response(null, {
    status: 200,
    headers: {
      etag: meta.etag,
      'content-type': meta.contentType,
      'content-length': String(meta.size),
      'accept-ranges': 'bytes',
    },
  });
}

async function handleDelete(store: ObjectStore, t: Target): Promise<Response> {
  await store.delete(t.bucket, t.key);
  return new Response(null, { status: 204 });
}

export function createS3Handler(opts: S3HandlerOptions): (req: Request) => Promise<Response> {
  const { store, credentials } = opts;

  return async (req: Request): Promise<Response> => {
    const verified = verifyRequest(req, credentials);
    if (!verified.ok) return new Response(null, { status: 403 });

    const url = new URL(req.url);
    const target = parseTarget(url);
    if (!target) return new Response(null, { status: 400 });

    const isList =
      req.method === 'GET' && url.searchParams.get('list-type') === '2' && target.key === '';
    if (isList) return handleList(store, target.bucket, url);

    if (target.key === '') return new Response(null, { status: 400 });

    switch (req.method) {
      case 'PUT':
        return handlePut(store, target, req);
      case 'GET':
        return handleGet(store, target, req);
      case 'HEAD':
        return handleHead(store, target);
      case 'DELETE':
        return handleDelete(store, target);
      default:
        return new Response(null, { status: 405 });
    }
  };
}
