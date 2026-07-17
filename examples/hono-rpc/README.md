# Simple Hono RPC example

A public Hono app calls one private calculator service:

```text
GET /double/21 -> Hono app -> calculator.double({ value: 21 }) -> { result: 42 }
```

The example is intentionally flat:

```text
src/
├── index.ts               # public Hono app and RPC client
├── calculator.ts          # private RPC provider
├── contract.ts            # shared oRPC contract
├── app-service.ts         # app deployment declaration
└── calculator-service.ts  # calculator deployment declaration
```

There are two runtime files because the app and calculator are two separately
deployed Compute processes. Each deployment also has one tiny declaration file
because Compute boots a service through that file's default export. There are
no `gateway/` or `math/` folder hierarchies.

## Shared contract

```ts
export const calculatorContract = contract({
  double: oc.input(type({ value: 'number' })).output(type({ result: 'number' })),
});
```

## Private provider

```ts
const rpc = implement(calculatorContract.router);

const handler = serve(calculatorService, {
  rpc: rpc.router({
    double: rpc.double.handler(({ input }) => ({
      result: input.value * 2,
    })),
  }),
});
```

## Hono app

```ts
const { calculator } = appService.load();

app.get('/double/:value', async (context) => {
  const { result } = await calculator.double({
    value: Number(context.req.param('value')),
  });

  return context.json({ result });
});
```

Composer supplies the calculator URL and a private service key from the
declared dependency edge. Hono does not need a Composer-specific integration.

## Run the verification

```sh
pnpm --filter @prisma/example-hono-rpc typecheck
pnpm --filter @prisma/example-hono-rpc build
pnpm --filter @prisma/example-hono-rpc test
```

## Deploy

Set `PRISMA_SERVICE_TOKEN` and `PRISMA_WORKSPACE_ID`, then run:

```sh
pnpm --filter @prisma/example-hono-rpc deploy
```

Open the app Compute URL at `/double/21`.
