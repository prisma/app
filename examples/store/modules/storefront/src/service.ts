import nextjs from '@prisma/composer/nextjs';
import { rpc } from '@prisma/composer/rpc';
import { compute } from '@prisma/composer-prisma-cloud';
import { catalogContract } from '@store/catalog/contract';
import { ordersContract } from '@store/orders/contract';

// The storefront's whole declaration: what it is (a Next.js compute service)
// and what it needs (typed clients of the catalog and orders contracts). Who
// provides them is the root module's decision, not this file's.
export default compute({
  name: 'storefront',
  deps: {
    catalog: rpc(catalogContract),
    orders: rpc(ordersContract),
  },
  build: nextjs({ module: import.meta.url, appDir: '..' }),
});
