# Goals

This document captures the **high-level aims** of AppKit as currently understood. It should remain stable and be updated only when the project’s purpose changes.

## Project goals

- **TypeScript-first applications**: Enable application developers to write applications in TypeScript for the Prisma Platform.
- **Code-first topology**: Let the structure of the TypeScript application define the service topology and allow AppKit to infer infrastructure requirements (IaC) from that structure.
- **Control/execution split**: Support a control-plane mode (inspect/plan/emit/provision) and an execution-plane mode (DI/graph satisfaction/run entrypoints).
- **Agent-friendly by design**: Make applications easy for AI agents to scaffold and evolve by using explicit, statically analyzable primitives and predictable composition points.
- **Streaming-first**: Make realtime/streaming the default communication and data access paradigm (Durable Streams as the backbone).

## Non-goals (for now)

- Defining the full Prisma Platform orchestration API surface (AppKit should emit metadata; platform orchestration can evolve independently).
