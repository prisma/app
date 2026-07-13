import { module } from '@prisma/compose';
import catalogModule from '@store/catalog';
import ordersModule from '@store/orders';
import storefrontService from '@store/storefront';

/**
 * The store app: three components, three edges.
 *
 *   storefront ──rpc──▶ catalog   (browse products)
 *   storefront ──rpc──▶ orders    (place + list orders)
 *   orders     ──rpc──▶ catalog   (price an order at placement time)
 *
 * catalog and orders each own their own Postgres internally — the root never
 * sees it. All it wires are the exposed, typed rpc ports.
 */
export default module('store', ({ provision }) => {
  const catalog = provision(catalogModule);
  const orders = provision(ordersModule, { deps: { catalog: catalog.rpc } });
  provision(storefrontService, { deps: { catalog: catalog.rpc, orders: orders.rpc } });
});
