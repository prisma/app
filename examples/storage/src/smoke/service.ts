import node from '@prisma/compose/node';
import { compute } from '@prisma/compose-prisma-cloud';
import { s3 } from '@prisma/compose-prisma-cloud/storage';

/**
 * The in-deployment smoke consumer: it depends on the storage module's `store`
 * port via an `s3()` slot, so `load()` hands it the full `S3Config` (url,
 * bucket, minted creds) — no external creds read. Its server runs the aws-sdk
 * op suite on request and reports pass/fail; the harness curls it (only the URL
 * surfaces).
 */
export default compute({
  name: 'smoke',
  deps: { blob: s3() },
  build: node({ module: import.meta.url, entry: '../../dist/smoke/server.mjs' }),
});
