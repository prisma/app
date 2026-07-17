import { contract, oc } from '@prisma/composer/rpc';
import { type } from 'arktype';

export const calculatorContract = contract({
  double: oc.input(type({ value: 'number' })).output(type({ result: 'number' })),
});
