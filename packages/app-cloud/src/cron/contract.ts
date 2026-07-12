/**
 * The one call edge between the scheduler and the app's router: `trigger(jobId)`.
 * The scheduler depends on it (`rpc(triggerContract)`); the router exposes it
 * (`expose: { trigger: triggerContract }`). `jobId` travels as data through this
 * single method — adding a job never adds a method, service, or port.
 */
import { contract, rpc } from '@prisma/app-rpc';
import { jobIdSchema, okSchema } from './standard-schema.ts';

export const triggerContract = contract({
  trigger: rpc({ input: jobIdSchema, output: okSchema }),
});

export type TriggerContract = typeof triggerContract;
