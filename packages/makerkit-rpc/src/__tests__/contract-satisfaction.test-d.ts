/**
 * Ports contract-satisfaction.poc.ts's accept/reject matrix onto real
 * arktype schemas and this package's contract()/rpc(). Typechecked only
 * (the package's `typecheck` script) — never executed: the reject cases are
 * structurally valid providers that simply fail Load's nominal satisfies()
 * check (see contract.test.ts), so running this file would throw. `.test-d`
 * (not `.test`) keeps it out of `bun test`.
 */
import { type Consumer, type Contract, provision } from '@makerkit/core';
import { type } from 'arktype';
import { contract } from '../contract.ts';
import { type Client, rpc } from '../rpc.ts';

const authContract = contract({
  verify: rpc({ input: type({ token: 'string' }), output: type({ ok: 'boolean' }) }),
});

declare const storefront: Consumer<{ auth: typeof authContract }>;

// candidate providers (standing in for provisioned refs' exposed contracts)
const exact = contract({
  verify: rpc({ input: type({ token: 'string' }), output: type({ ok: 'boolean' }) }),
});
const extraOut = contract({
  verify: rpc({
    input: type({ token: 'string' }),
    output: type({ ok: 'boolean', user: 'string' }),
  }),
});
const extraMethod = contract({
  verify: rpc({ input: type({ token: 'string' }), output: type({ ok: 'boolean' }) }),
  refresh: rpc({ input: type({ rt: 'string' }), output: type({ token: 'string' }) }),
});
const extraInput = contract({
  verify: rpc({
    input: type({ token: 'string', tenant: 'string' }),
    output: type({ ok: 'boolean' }),
  }),
});
const missing = contract({
  whoami: rpc({ input: type({}), output: type({ id: 'string' }) }),
});

// a second protocol kind, standing in for one @makerkit/rpc knows nothing
// about — only to prove cross-protocol wiring is rejected by the brand.
declare function wsContract<
  // biome-ignore lint/suspicious/noExplicitAny: mirrors contract-satisfaction.poc.ts's `wsContract` stub.
  Fns extends Record<string, (input: any) => Promise<any>>,
>(fns: Fns): Contract<'ws', Fns>;
const wrongKind = wsContract({
  verify: rpc({ input: type({ token: 'string' }), output: type({ ok: 'boolean' }) }),
});

// ---- MUST compile ----
provision('s1', storefront, { auth: exact });
provision('s2', storefront, { auth: extraOut }); // covariant output
provision('s3', storefront, { auth: extraMethod }); // width

// ---- MUST be rejected ----
// @ts-expect-error provider requires an extra input the consumer never sends (contravariant)
provision('s4', storefront, { auth: extraInput });
// @ts-expect-error provider is missing the required method
provision('s5', storefront, { auth: missing });
// @ts-expect-error different protocol kind
provision('s6', storefront, { auth: wrongKind });

// ---- and the derived client is typed both ways ----
export async function clientUsage() {
  const auth = null as unknown as Client<typeof authContract>;
  const r = await auth.verify({ token: 't' });
  const ok: boolean = r.ok;
  // @ts-expect-error unknown method
  auth.nope();
  // @ts-expect-error wrong input shape (token must be a string)
  await auth.verify({ token: 123 });
  return ok;
}
