/**
 * An in-memory catalog for TESTING a module that depends on it — no Postgres,
 * no deploy. It implements the real `catalogContract`, so its native router is
 * type-checked against the same contract the real catalog exposes. Test-only,
 * deliberately outside `src/`, so it never rides into the deployed artifact.
 */
import node from '@prisma/composer/node';
import { implement, serve } from '@prisma/composer/rpc';
import { compute } from '@prisma/composer-prisma-cloud';
import { catalogContract, type Product } from '../src/contract.ts';

export const FAKE_PRODUCTS: Product[] = [
  { id: 'espresso', name: 'Espresso', description: 'A double shot.', priceCents: 350 },
  { id: 'croissant', name: 'Croissant', description: 'Baked every morning.', priceCents: 400 },
];

const fakeCatalog = compute({
  name: 'catalog-fake',
  deps: {},
  build: node({ module: import.meta.url, entry: 'fake.ts' }),
  expose: { rpc: catalogContract },
});

let specialIdx = 0;

const rpc = implement(catalogContract.router);
const router = rpc.router({
  listProducts: rpc.listProducts.handler(() => ({ products: FAKE_PRODUCTS })),
  getProduct: rpc.getProduct.handler(({ input }) => ({
    product: FAKE_PRODUCTS.find((p) => p.id === input.id) ?? null,
  })),
  getSpecial: rpc.getSpecial.handler(() => ({ product: FAKE_PRODUCTS[specialIdx] })),
  rotateSpecial: rpc.rotateSpecial.handler(() => {
    specialIdx = (specialIdx + 1) % FAKE_PRODUCTS.length;
    return { product: FAKE_PRODUCTS[specialIdx] };
  }),
});

export default serve(fakeCatalog, { rpc: router });
