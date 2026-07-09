import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';
import { type ManagementApiClient, ManagementClient } from '../client.ts';
import { call, PrismaApiError } from '../http.ts';

/**
 * The workspace's dedicated project for hosted deploy state. A project is
 * the closest expressible stand-in for "ambient platform infrastructure" —
 * PDP has no workspace-level database, and the app's own project is
 * circular (it doesn't exist before the first apply, and is itself tracked
 * in the state it would have to host).
 */
const STATE_PROJECT_NAME = 'makerkit-state';

interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly workspace: { readonly id: string };
}

interface DatabaseSummary {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
}

export interface StateConnection {
  readonly projectId: string;
  readonly databaseId: string;
  readonly connectionString: Redacted.Redacted<string>;
}

const listAllProjects = (
  client: ManagementApiClient,
): Effect.Effect<readonly ProjectSummary[], PrismaApiError> =>
  Effect.gen(function* () {
    const projects: ProjectSummary[] = [];
    let cursor: string | undefined;
    for (;;) {
      const query = cursor === undefined ? {} : { cursor };
      const page = yield* call(() => client.GET('/v1/projects', { params: { query } }));
      projects.push(...page.data);
      if (!page.pagination.hasMore || page.pagination.nextCursor === null) break;
      cursor = page.pagination.nextCursor;
    }
    return projects;
  });

const findStateProject = (
  client: ManagementApiClient,
  workspaceId: string,
): Effect.Effect<ProjectSummary | undefined, PrismaApiError> =>
  listAllProjects(client).pipe(
    Effect.map((projects) =>
      projects.find((p) => p.workspace.id === workspaceId && p.name === STATE_PROJECT_NAME),
    ),
  );

const createStateProject = (
  client: ManagementApiClient,
  workspaceId: string,
): Effect.Effect<ProjectSummary, PrismaApiError> =>
  call(() =>
    client.POST('/v1/projects', {
      body: { name: STATE_PROJECT_NAME, workspaceId },
    }),
  ).pipe(Effect.map((r) => r.data));

/**
 * Find-or-create the workspace's `makerkit-state` project. Two first-ever
 * deployers can both attempt creation; only one wins. On a create failure,
 * re-list and adopt the winner by name rather than fail outright — if the
 * project still isn't there after re-listing, the failure was real and is
 * re-raised. This residual race (a third failure mode neither list nor
 * create can fully rule out) is accepted for this PoC.
 */
const findOrCreateStateProject = (
  client: ManagementApiClient,
  workspaceId: string,
): Effect.Effect<ProjectSummary, PrismaApiError> =>
  Effect.gen(function* () {
    const existing = yield* findStateProject(client, workspaceId);
    if (existing !== undefined) return existing;

    return yield* createStateProject(client, workspaceId).pipe(
      Effect.matchEffect({
        onSuccess: (created) => Effect.succeed(created),
        onFailure: (createError) =>
          findStateProject(client, workspaceId).pipe(
            Effect.flatMap((adopted) =>
              adopted === undefined ? Effect.fail(createError) : Effect.succeed(adopted),
            ),
          ),
      }),
    );
  });

const listAllDatabases = (
  client: ManagementApiClient,
  projectId: string,
): Effect.Effect<readonly DatabaseSummary[], PrismaApiError> =>
  Effect.gen(function* () {
    const databases: DatabaseSummary[] = [];
    let cursor: string | undefined;
    for (;;) {
      const query = cursor === undefined ? {} : { cursor };
      const page = yield* call(() =>
        client.GET('/v1/projects/{projectId}/databases', {
          params: { path: { projectId }, query },
        }),
      );
      databases.push(...page.data);
      if (!page.pagination.hasMore || page.pagination.nextCursor === null) break;
      cursor = page.pagination.nextCursor;
    }
    return databases;
  });

/**
 * The project's default database — auto-provisioned at project creation.
 * Never create a database here: a project already has exactly one default,
 * and creating another 409s (FT-5220).
 */
const findDefaultDatabase = (
  client: ManagementApiClient,
  projectId: string,
): Effect.Effect<DatabaseSummary, PrismaApiError> =>
  listAllDatabases(client, projectId).pipe(
    Effect.flatMap((databases) => {
      const found = databases.find((d) => d.isDefault);
      return found === undefined
        ? Effect.fail(
            new PrismaApiError({
              status: 0,
              message: `project ${projectId} (${STATE_PROJECT_NAME}) has no default database`,
            }),
          )
        : Effect.succeed(found);
    }),
  );

/**
 * Mints a fresh Postgres connection for this run and reads the direct
 * endpoint's DSN. Never `endpoints.pooled`, the deprecated top-level
 * `connectionString`/`url` (PRO-212) — those are not guaranteed by the
 * platform. The DSN is write-only on read (a stored connection can't be
 * re-read later), which is exactly why a fresh connection is minted every
 * run instead of reusing one.
 */
const mintConnection = (
  client: ManagementApiClient,
  databaseId: string,
): Effect.Effect<Redacted.Redacted<string>, PrismaApiError> =>
  call(() =>
    client.POST('/v1/databases/{databaseId}/connections', {
      params: { path: { databaseId } },
      body: { name: `makerkit-state-${Date.now()}` },
    }),
  ).pipe(
    Effect.flatMap((r) => {
      const created = r.data;
      const dsn = created.endpoints.direct?.connectionString;
      return dsn === undefined
        ? Effect.fail(
            new PrismaApiError({
              status: 0,
              message: `connection ${created.id} returned no endpoints.direct.connectionString (PRO-212)`,
            }),
          )
        : Effect.succeed(Redacted.make(dsn));
    }),
  );

/**
 * Find-or-create the workspace's `makerkit-state` project, resolve its
 * default database, and mint a fresh connection — the automatic bootstrap
 * every deploy runs once, needing nothing beyond the service token and
 * workspace id a deployer already has.
 */
export const bootstrapStateConnection = (
  workspaceId: string,
): Effect.Effect<StateConnection, PrismaApiError, ManagementClient> =>
  Effect.gen(function* () {
    const client = yield* ManagementClient;
    const project = yield* findOrCreateStateProject(client, workspaceId);
    const database = yield* findDefaultDatabase(client, project.id);
    const connectionString = yield* mintConnection(client, database.id);
    return { projectId: project.id, databaseId: database.id, connectionString };
  });
