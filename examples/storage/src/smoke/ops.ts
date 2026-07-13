/**
 * The aws-sdk smoke suite (spec § 8): every in-scope op driven by a real
 * `@aws-sdk/client-s3` against a given `{ url, bucket, accessKeyId,
 * secretAccessKey }`. Path-style, region `auto`, and
 * `requestChecksumCalculation: 'WHEN_REQUIRED'` — the module rejects aws-chunked
 * PUTs by design (F2). Runs against BOTH the local stand-in (the example's
 * local test) and the deployed store (the in-deployment smoke server), so the
 * one suite is proven before the cloud run.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface S3Access {
  readonly url: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export interface OpResult {
  readonly op: string;
  readonly ok: boolean;
  readonly detail?: string;
}

export interface SmokeResult {
  readonly ok: boolean;
  readonly results: readonly OpResult[];
}

const TEXT = new TextEncoder();

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** aws-sdk's response `Body` — an SDK stream with `transformToByteArray`. */
function collect(body: unknown): Promise<Uint8Array> {
  if (
    typeof body === 'object' &&
    body !== null &&
    'transformToByteArray' in body &&
    typeof body.transformToByteArray === 'function'
  ) {
    return body.transformToByteArray();
  }
  throw new Error('response body is not an aws-sdk byte stream');
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The HTTP status an aws-sdk error carries in `$metadata`, or undefined. */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('$metadata' in error)) return undefined;
  const meta = error.$metadata;
  if (typeof meta !== 'object' || meta === null || !('httpStatusCode' in meta)) return undefined;
  return typeof meta.httpStatusCode === 'number' ? meta.httpStatusCode : undefined;
}

/** Run the full op suite; never throws — each op's pass/fail is captured. */
export async function runSmoke(access: S3Access): Promise<SmokeResult> {
  const client = new S3Client({
    region: 'auto',
    endpoint: access.url,
    forcePathStyle: true,
    credentials: { accessKeyId: access.accessKeyId, secretAccessKey: access.secretAccessKey },
    // The module rejects aws-chunked / flexible-checksum PUTs (F2).
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 3,
  });
  const bucket = access.bucket;
  // Unique key namespace per run so repeated smokes never collide.
  const base = `smoke/${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const results: OpResult[] = [];

  const op = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
      results.push({ op: name, ok: true });
    } catch (error) {
      results.push({ op: name, ok: false, detail: errorMessage(error) });
    }
  };

  await op('put-get-roundtrip', async () => {
    const key = `${base}/roundtrip`;
    const put = await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: TEXT.encode('hello world'),
        ContentType: 'text/plain',
      }),
    );
    assert(/^"[0-9a-f]{64}"$/.test(put.ETag ?? ''), `unexpected ETag ${put.ETag}`);
    const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    assert(decode(await collect(got.Body)) === 'hello world', 'bytes did not round-trip');
    assert(got.ContentType === 'text/plain', `content-type ${got.ContentType}`);
    assert(got.ETag === put.ETag, 'ETag changed between put and get');
  });

  await op('ranged-get-closed', async () => {
    const key = `${base}/ranged`;
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: TEXT.encode('0123456789') }),
    );
    const got = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=2-5' }),
    );
    assert(decode(await collect(got.Body)) === '2345', 'wrong closed-range slice');
    assert(got.ContentRange === 'bytes 2-5/10', `content-range ${got.ContentRange}`);
  });

  await op('ranged-get-open-ended', async () => {
    const key = `${base}/ranged-open`;
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: TEXT.encode('0123456789') }),
    );
    const got = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=7-' }),
    );
    assert(decode(await collect(got.Body)) === '789', 'wrong open-ended-range slice');
    assert(got.ContentRange === 'bytes 7-9/10', `content-range ${got.ContentRange}`);
  });

  await op('head', async () => {
    const key = `${base}/head`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: TEXT.encode('12345'),
        ContentType: 'text/plain',
      }),
    );
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    assert(head.ContentLength === 5, `content-length ${head.ContentLength}`);
    assert(head.ContentType === 'text/plain', `content-type ${head.ContentType}`);
    assert(/^"[0-9a-f]{64}"$/.test(head.ETag ?? ''), `unexpected ETag ${head.ETag}`);
  });

  await op('delete-idempotent', async () => {
    const key = `${base}/del`;
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: TEXT.encode('x') }));
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    let missing = false;
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error) {
      missing = statusOf(error) === 404;
    }
    assert(missing, 'object still present after delete');
    const second = await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    assert(
      second.$metadata.httpStatusCode === 204,
      `re-delete status ${second.$metadata.httpStatusCode}`,
    );
  });

  await op('list-pagination', async () => {
    const prefix = `${base}/list/`;
    for (const suffix of ['a', 'b', 'c']) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${prefix}${suffix}`,
          Body: TEXT.encode(suffix),
        }),
      );
    }
    const page1 = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 2 }),
    );
    assert((page1.Contents ?? []).length === 2, `page1 had ${(page1.Contents ?? []).length} keys`);
    assert(page1.IsTruncated === true, 'page1 not truncated');
    assert(page1.NextContinuationToken !== undefined, 'no continuation token');
    const page2 = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 2,
        ContinuationToken: page1.NextContinuationToken,
      }),
    );
    assert((page2.Contents ?? []).length === 1, `page2 had ${(page2.Contents ?? []).length} keys`);
    assert(page2.IsTruncated === false, 'page2 truncated');
    const keys = [...(page1.Contents ?? []), ...(page2.Contents ?? [])].map((c) => c.Key);
    assert(keys.join(',') === `${prefix}a,${prefix}b,${prefix}c`, `keys ${keys.join(',')}`);
  });

  await op('missing-get-404', async () => {
    let code: number | undefined;
    try {
      await client.send(new GetObjectCommand({ Bucket: bucket, Key: `${base}/nope` }));
    } catch (error) {
      code = statusOf(error);
    }
    assert(code === 404, `expected 404, got ${code}`);
  });

  await op('missing-head-404', async () => {
    let code: number | undefined;
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: `${base}/nope` }));
    } catch (error) {
      code = statusOf(error);
    }
    assert(code === 404, `expected 404, got ${code}`);
  });

  await op('presigned-put-get', async () => {
    const key = `${base}/presigned`;
    const putUrl = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: 900,
    });
    const putRes = await fetch(putUrl, { method: 'PUT', body: TEXT.encode('presigned body') });
    assert(putRes.status === 200, `presigned PUT status ${putRes.status}`);
    const getUrl = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: 900,
    });
    const getRes = await fetch(getUrl);
    assert(getRes.status === 200, `presigned GET status ${getRes.status}`);
    assert((await getRes.text()) === 'presigned body', 'presigned bytes did not round-trip');
  });

  return { ok: results.every((r) => r.ok), results };
}
