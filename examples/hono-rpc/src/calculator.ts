import { implement, serve } from '@prisma/composer/rpc';
import calculatorService from './calculator-service.ts';
import { calculatorContract } from './contract.ts';

const rpc = implement(calculatorContract.router);

const handler = serve(calculatorService, {
  rpc: rpc.router({
    double: rpc.double.handler(({ input }) => ({
      result: input.value * 2,
    })),
  }),
});

const { port } = calculatorService.config();

export default handler;

Bun.serve({ port, hostname: '0.0.0.0', fetch: handler });
