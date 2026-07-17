/**
 * catalog's public RPC contract. It lives with the module that owns it; a
 * consumer imports it and depends on it via `rpc(catalogContract)`, getting
 * back a typed client.
 */
import { contract, oc } from '@prisma/composer/rpc';
import { type } from 'arktype';

export const product = type({
  id: 'string',
  name: 'string',
  description: 'string',
  priceCents: 'number',
});

export type Product = typeof product.infer;

export const catalogContract = contract({
  listProducts: oc.input(type({})).output(type({ products: product.array() })),
  getProduct: oc.input(type({ id: 'string' })).output(type({ product: product.or('null') })),
  getSpecial: oc.input(type({})).output(type({ product: product.or('null') })),
  rotateSpecial: oc.input(type({})).output(type({ product: product.or('null') })),
});
