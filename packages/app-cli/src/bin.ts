#!/usr/bin/env node
import { UsageError } from 'clipanion';
import { run } from './main.ts';

run(process.argv.slice(2))
  .then((status) => {
    process.exitCode = status;
  })
  .catch((error: unknown) => {
    if (error instanceof UsageError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
