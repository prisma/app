/**
 * The (empty) app-space contract wrapped into the framework's `prisma-next`
 * kind — the resource end references it (`pnPostgres({ name, contract,
 * config })`); no service consumes the app space, so there is no dependency
 * end: the auth module claims the database through its own `authDb()` pack
 * requirement.
 */
import { pnContract } from '@prisma/composer-prisma-cloud/prisma-next';
import type { Contract } from '../contract.d.ts';
import contractJson from '../contract.json' with { type: 'json' };

export const appContract = pnContract<Contract>(contractJson);
