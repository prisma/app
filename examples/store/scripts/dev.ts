/**
 * Local dev, no cloud: serve an in-memory catalog and orders on loopback
 * ports, then run the storefront via `next dev` with CATALOG_URL/ORDERS_URL
 * pointing at them. The storefront can't tell the difference — it talks to
 * any producer of the contracts, and these fakes are type-checked against
 * the same contracts the real modules serve.
 */
import node from '@prisma/composer/node';
import { implement, serve } from '@prisma/composer/rpc';
import { compute } from '@prisma/composer-prisma-cloud';
import fakeCatalogHandler, { FAKE_PRODUCTS } from '@store/catalog/fake';
import { type Order, ordersContract } from '@store/orders/contract';

const catalog = Bun.serve({ port: 0, fetch: fakeCatalogHandler });

// Stateful, unlike @store/orders/fake: placed orders show up in the UI.
const placed: Order[] = [];
const ordersNode = compute({
  name: 'orders-dev',
  deps: {},
  build: node({ module: import.meta.url, entry: 'dev.ts' }),
  expose: { rpc: ordersContract },
});
const rpc = implement(ordersContract.router);
const router = rpc.router({
  placeOrder: rpc.placeOrder.handler(({ input }) => {
    const product = FAKE_PRODUCTS.find((p) => p.id === input.productId);
    if (!product || input.quantity < 1) return { order: null };
    const order: Order = {
      id: crypto.randomUUID(),
      productId: product.id,
      productName: product.name,
      quantity: input.quantity,
      totalCents: product.priceCents * input.quantity,
      placedAt: new Date().toISOString(),
    };
    placed.unshift(order);
    return { order };
  }),
  listOrders: rpc.listOrders.handler(() => ({ orders: placed })),
});
const orders = Bun.serve({
  port: 0,
  fetch: serve(ordersNode, { rpc: router }),
});

console.log(`fake catalog  ${catalog.url}`);
console.log(`fake orders   ${orders.url}`);

const storefront = Bun.spawn(['pnpm', 'next', 'dev'], {
  cwd: new URL('../modules/storefront', import.meta.url).pathname,
  env: { ...process.env, CATALOG_URL: catalog.url.href, ORDERS_URL: orders.url.href },
  stdio: ['inherit', 'inherit', 'inherit'],
});
await storefront.exited;
