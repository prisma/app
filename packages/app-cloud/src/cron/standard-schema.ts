/**
 * Hand-rolled Standard Schema validators for cron's own shapes (no external
 * validator dependency — mirrors `@prisma/app`'s `config.ts` `scalarSchema`).
 */
import type { StandardSchemaV1 } from '@standard-schema/spec';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function issue(message: string): StandardSchemaV1.FailureResult {
  return { issues: [{ message }] };
}

/** `{ jobId: string }[]` — the scheduler's `jobs` param. */
export const jobsSchema: StandardSchemaV1<ReadonlyArray<{ jobId: string; every: string }>> = {
  '~standard': {
    version: 1,
    vendor: '@prisma/app-cloud',
    validate: (value: unknown) => {
      if (!Array.isArray(value)) return issue('expected an array of jobs');
      const jobs: Array<{ jobId: string; every: string }> = [];
      for (const entry of value) {
        if (
          !isRecord(entry) ||
          typeof entry['jobId'] !== 'string' ||
          typeof entry['every'] !== 'string'
        ) {
          return issue('expected each job to be { jobId: string, every: string }');
        }
        jobs.push({ jobId: entry['jobId'], every: entry['every'] });
      }
      return { value: jobs };
    },
  },
};

/** `{ jobId: string }` — the trigger contract's input. */
export const jobIdSchema: StandardSchemaV1<{ jobId: string }> = {
  '~standard': {
    version: 1,
    vendor: '@prisma/app-cloud',
    validate: (value: unknown) =>
      isRecord(value) && typeof value['jobId'] === 'string'
        ? { value: { jobId: value['jobId'] } }
        : issue('expected { jobId: string }'),
  },
};

/** `{ ok: boolean }` — the trigger contract's output. */
export const okSchema: StandardSchemaV1<{ ok: boolean }> = {
  '~standard': {
    version: 1,
    vendor: '@prisma/app-cloud',
    validate: (value: unknown) =>
      isRecord(value) && typeof value['ok'] === 'boolean'
        ? { value: { ok: value['ok'] } }
        : issue('expected { ok: boolean }'),
  },
};
