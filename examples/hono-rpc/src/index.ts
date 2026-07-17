import { Hono } from 'hono';
import appService from './app-service.ts';

const { calculator } = appService.load();
const { port } = appService.config();

const app = new Hono();

app.get('/double/:value', async (context) => {
  const value = Number(context.req.param('value'));
  if (!Number.isFinite(value)) {
    return context.json({ error: 'value must be a finite number' }, 400);
  }

  const { result } = await calculator.double({ value }, { signal: context.req.raw.signal });

  return context.json({ result });
});

export default app;

Bun.serve({ port, hostname: '0.0.0.0', fetch: app.fetch });
