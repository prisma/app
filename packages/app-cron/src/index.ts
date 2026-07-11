/**
 * Cron as a driver: an always-on scheduler that depends on a single
 * `trigger(jobId)` endpoint and calls it on a timer (ADR-0020). This entry is
 * the authoring API — `defineSchedule` + `cronScheduler` + `serveSchedule` +
 * the trigger contract. `cron()` (the system helper) ships in a later
 * dispatch.
 */
export type { TriggerContract } from './contract.ts';
export { triggerContract } from './contract.ts';
export type { Schedule } from './schedule.ts';
export { defineSchedule } from './schedule.ts';
export { cronScheduler } from './scheduler.ts';
export { serveSchedule } from './serve-schedule.ts';
