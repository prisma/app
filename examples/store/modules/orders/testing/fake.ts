/**
 * An in-memory orders service for TESTING a module that depends on it — no
 * Postgres, no catalog, no deploy. It implements the real `ordersContract`, so
 * its native router is type-checked against the same contract the real orders
 * exposes. Test-only, deliberately outside `src/`.
 */
import node from '@prisma/composer/node';
import { implement, serve } from '@prisma/composer/rpc';
import { compute } from '@prisma/composer-prisma-cloud';
import { type Order, ordersContract } from '../src/contract.ts';

export const FAKE_ORDERS: Order[] = [
  {
    id: 'order-1',
    productId: 'espresso',
    productName: 'Espresso',
    quantity: 2,
    totalCents: 700,
    placedAt: '2026-07-13T08:00:00.000Z',
  },
];

const fakeOrders = compute({
  name: 'orders-fake',
  deps: {},
  build: node({ module: import.meta.url, entry: 'fake.ts' }),
  expose: { rpc: ordersContract },
});

const rpc = implement(ordersContract.router);
const router = rpc.router({
  placeOrder: rpc.placeOrder.handler(({ input }) => ({
    order: {
      id: `order-${FAKE_ORDERS.length + 1}`,
      productId: input.productId,
      productName: input.productId,
      quantity: input.quantity,
      totalCents: 100 * input.quantity,
      placedAt: '2026-07-13T09:00:00.000Z',
    },
  })),
  listOrders: rpc.listOrders.handler(() => ({ orders: FAKE_ORDERS })),
});

export default serve(fakeOrders, { rpc: router });
