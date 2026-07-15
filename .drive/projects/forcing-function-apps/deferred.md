# Deferred

## Upstream the open-chat streams-server performance patch (2026-07-15)

open-chat pins `@prisma/streams-server@0.1.11` with a `patchedDependencies`
patch: parallel bootstrap segment-head restore
(`STREAMS_BOOTSTRAP_HEAD_CONCURRENCY`) and an AbortController honoring
`DS_OBJECTSTORE_TIMEOUT_MS` in the R2 client. Not upstream as of 0.1.11. The
streams module (slice streams-composed-module) runs unpatched — correctness
is unaffected, cold-start bootstrap is just sequential/slower. When it
matters, make it a minimal PR to prisma/streams, not a vendored copy.
Related observation for the same PR: `withTimeout` in `src/util/retry.ts`
never clears its loser timer, so the process lingers up to
`DS_OBJECTSTORE_TIMEOUT_MS` after SIGTERM.
