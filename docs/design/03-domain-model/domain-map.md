# Domain map

This is an evolving, high-level map of AppKit’s bounded contexts (domains) and their dependency direction.

## Draft domain map (WIP)

```mermaid
flowchart TD
  userFacing[UserFacingLibraries]

  controlPlane[AppkitControlPlane]
  executionPlane[AppkitExecutionPlane]

  streams[DurableStreams]
  ingress[Ingress]
  postgres[PrismaPostgres]
  storage[FileStorage]

  artifacts[ArtifactsAndManifest]

  platform[PrismaPlatformOrchestration]
  localDev[LocalDevEmulation]

  userFacing --> controlPlane
  userFacing --> executionPlane

  controlPlane --> artifacts
  controlPlane --> streams
  controlPlane --> ingress
  controlPlane --> postgres
  controlPlane --> storage

  executionPlane --> streams
  executionPlane --> ingress
  executionPlane --> postgres
  executionPlane --> storage

  platform --> artifacts
  platform --> executionPlane

  localDev --> controlPlane
  localDev --> executionPlane

  %% Clean architecture intent: primitives do not depend on composition
  streams --> artifacts
  ingress --> artifacts
  postgres --> artifacts
  storage --> artifacts
```

Notes:

- The exact boundaries are expected to evolve as we refine responsibilities.
- The key invariant we want to preserve is **dependency direction**: low-level primitives remain decoupled; composition happens in user-facing packages.
