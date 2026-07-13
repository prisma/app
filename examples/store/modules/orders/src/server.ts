import { serve } from '@prisma/compose/rpc';
import { SQL } from 'bun';
import type { Order } from './contract.ts';
import service from './service.ts';

// load() hydrates both deps: db is a PostgresConfig, catalog is a typed
// client of catalogContract — calling it is a plain async function call.
const { db, catalog } = service.load();
const { port } = service.config();

// One pool per process. idleTimeout closes the pooled connection before
// Compute's scale-to-zero drops it, so the next request reconnects instead of
// erroring (FT-5219).
const sql = new SQL({ url: db.url, max: 1, idleTimeout: 10 });

// A Prisma Postgres direct connection is closed when it goes idle. Bun.SQL
// surfaces that as an async error with no awaiter, which would otherwise
// crash the process into a restart loop.
process.on('uncaughtException', (err) => console.error('uncaughtException', err));
process.on('unhandledRejection', (err) => console.error('unhandledRejection', err));

await sql`
  create table if not exists orders (
    id text primary key,
    product_id text not null,
    product_name text not null,
    quantity integer not null,
    total_cents integer not null,
    placed_at timestamptz not null default now()
  )
`;

const toOrder = (row: Record<string, unknown>): Order => ({
  id: String(row.id),
  productId: String(row.product_id),
  productName: String(row.product_name),
  quantity: Number(row.quantity),
  totalCents: Number(row.total_cents),
  placedAt: new Date(String(row.placed_at)).toISOString(),
});

const handler = serve(service, {
  rpc: {
    placeOrder: async ({ productId, quantity }) => {
      const { product } = await catalog.getProduct({ id: productId });
      if (product === null || quantity < 1) return { order: null };

      const rows = await sql`
        insert into orders (id, product_id, product_name, quantity, total_cents)
        values (${crypto.randomUUID()}, ${product.id}, ${product.name}, ${quantity}, ${product.priceCents * quantity})
        returning *
      `;
      return { order: toOrder(rows[0]) };
    },
    listOrders: async () => {
      const rows = await sql`select * from orders order by placed_at desc limit 20`;
      return { orders: rows.map(toOrder) };
    },
  },
});
export default handler;

// Bind all interfaces — Compute routes external HTTP to the VM, so a
// loopback-only listener would be unreachable.
Bun.serve({ port, hostname: '0.0.0.0', fetch: handler });
