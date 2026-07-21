import { spawnSync } from 'node:child_process';
import { CliError } from './cli-error.ts';

/** A stage name must be a valid git ref (deploy-cli.md) — checked via `git check-ref-format`, never silently normalized. Runs before anything platform-specific. */
export function validateStageName(stage: string): void {
  const result = spawnSync('git', ['check-ref-format', `refs/heads/${stage}`], {
    stdio: 'ignore',
  });
  if (result.error) {
    throw new CliError(
      `git is required to validate --stage "${stage}" (git check-ref-format): ${result.error.message}.`,
    );
  }
  if (result.status !== 0) {
    throw new CliError(
      `Invalid --stage "${stage}": must be a valid git ref name (git check-ref-format rejected "refs/heads/${stage}").`,
    );
  }
}
