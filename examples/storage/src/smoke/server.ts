// The smoke service's entrypoint (the build adapter's `entry`). After
// main.run(address, boot) re-keys the environment, service.load() hands the
// wired S3Config binding directly. `GET /` runs the full aws-sdk op suite
// against the deployed store and returns JSON { ok, results }; the harness
// curls it. Bind all interfaces — Compute routes external HTTP to the VM.
import { runSmoke } from './ops.ts';
import service from './service.ts';

const { blob } = service.load(); // S3Config: { url, bucket, accessKeyId, secretAccessKey }
const { port } = service.config();

process.on('uncaughtException', (err) => console.error('uncaughtException', err));
process.on('unhandledRejection', (err) => console.error('unhandledRejection', err));

Bun.serve({
  port,
  hostname: '0.0.0.0',
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/health') return new Response('ok', { status: 200 });
    if (path === '/') {
      const result = await runSmoke(blob);
      return new Response(JSON.stringify(result, null, 2), {
        status: result.ok ? 200 : 500,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  },
});
