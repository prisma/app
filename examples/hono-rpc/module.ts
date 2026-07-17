import { module } from '@prisma/composer';
import appService from './src/app-service.ts';
import calculatorService from './src/calculator-service.ts';

/** A Hono app connected to a private typed RPC service. */
export default module('hono-rpc-example', ({ provision }) => {
  const calculator = provision(calculatorService);
  provision(appService, { deps: { calculator: calculator.rpc } });
});
