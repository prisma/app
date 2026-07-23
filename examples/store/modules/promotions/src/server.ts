import { serveSchedule } from '@prisma/composer-prisma-cloud/cron';
import service, { schedule } from './service.ts';

// serveSchedule is exhaustive over the schedule's job ids at compile time —
// omitting `rotateSpecial` here would be a type error. The handler body is
// where a job id maps to whatever calls implement it.
const handler = serveSchedule(service, schedule, {
  rotateSpecial: async (deps) => {
    const { product } = await deps.catalog.rotateSpecial({});
    console.log(`special rotated to ${product?.name ?? '(no products)'}`);
  },
});
export default handler;

const port = Number(process.env['PORT']); // set by run() (and bootstrapService) before boot (ADR-0041)

// Bind all interfaces — Compute routes external HTTP to the VM, so a
// loopback-only listener would be unreachable.
Bun.serve({ port, hostname: '0.0.0.0', fetch: handler });
