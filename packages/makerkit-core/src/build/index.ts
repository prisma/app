/**
 * Build-time helpers: produce a deployable Compute artifact whose entrypoint
 * is the host shim wrapping a user service. Not bundled into the artifact —
 * this runs on the developer/CI machine.
 */
export { buildServiceArtifact, hostEntrySource } from "./artifact.ts";
export type {
  BuildServiceArtifactOptions,
  BuildServiceArtifactResult,
} from "./artifact.ts";
