import { beforeEach, describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import type { ManagementApiClient } from '../client.ts';
import { ManagementClient } from '../client.ts';
import { resolveContainer } from '../container.ts';

interface FakeProject {
  id: string;
  name: string;
  createdAt: string;
  workspace: { id: string };
}

interface FakeBranch {
  id: string;
  gitName: string;
  createdAt: string;
}

interface FakeState {
  projects: FakeProject[];
  branches: Record<string, FakeBranch[]>;
  projectCreateCalls: number;
  branchCreateCalls: number;
  /** When set, the first create for this gitName 409s (racing create), after seeding the winner's branch as if a concurrent caller created it first. */
  raceGitName?: string;
  raced: boolean;
}

const newFakeState = (overrides: Partial<FakeState> = {}): FakeState => ({
  projects: [],
  branches: {},
  projectCreateCalls: 0,
  branchCreateCalls: 0,
  raced: false,
  ...overrides,
});

const okResponse = <T>(data: T, status = 200) => ({
  data,
  error: undefined,
  response: new Response(null, { status }),
});

const errorResponse = (status: number) => ({
  data: undefined,
  error: { message: 'stubbed failure' },
  response: new Response(null, { status }),
});

/**
 * A stubbed `ManagementApiClient` covering only `/v1/projects` and
 * `/v1/projects/{projectId}/branches` — everything `resolveContainer`
 * calls. `as ManagementApiClient` is acceptable here (test file — exempt
 * from the no-bare-cast rule): this fake's shape already guarantees the
 * safety a hand-written openapi-fetch generic signature would.
 */
const fakeClient = (state: FakeState): ManagementApiClient => {
  const GET = (
    path: string,
    init: { params?: { path?: Record<string, string>; query?: Record<string, string> } } = {},
  ) => {
    if (path === '/v1/projects') {
      return Promise.resolve(
        okResponse({ data: state.projects, pagination: { nextCursor: null, hasMore: false } }),
      );
    }
    if (path === '/v1/projects/{projectId}/branches') {
      const projectId = init.params?.path?.['projectId'] ?? '';
      const gitName = init.params?.query?.['gitName'];
      const all = state.branches[projectId] ?? [];
      const data = gitName === undefined ? all : all.filter((b) => b.gitName === gitName);
      return Promise.resolve(
        okResponse({ data, pagination: { nextCursor: null, hasMore: false } }),
      );
    }
    throw new Error(`fakeClient: unexpected GET ${path}`);
  };

  const POST = (
    path: string,
    init: { params?: { path?: Record<string, string> }; body?: Record<string, unknown> } = {},
  ) => {
    if (path === '/v1/projects') {
      state.projectCreateCalls++;
      const id = `proj-${state.projectCreateCalls}`;
      const project: FakeProject = {
        id,
        name: String(init.body?.['name']),
        createdAt: new Date(state.projectCreateCalls).toISOString(),
        workspace: { id: String(init.body?.['workspaceId']) },
      };
      state.projects.push(project);
      return Promise.resolve(okResponse({ data: project }, 201));
    }
    if (path === '/v1/projects/{projectId}/branches') {
      const projectId = init.params?.path?.['projectId'] ?? '';
      const gitName = String(init.body?.['gitName']);
      state.branchCreateCalls++;

      if (state.raceGitName === gitName && !state.raced) {
        state.raced = true;
        const winner: FakeBranch = {
          id: `br-race-${gitName}`,
          gitName,
          createdAt: new Date().toISOString(),
        };
        state.branches[projectId] = [...(state.branches[projectId] ?? []), winner];
        return Promise.resolve(errorResponse(409));
      }

      const branch: FakeBranch = {
        id: `br-${projectId}-${state.branchCreateCalls}`,
        gitName,
        createdAt: new Date().toISOString(),
      };
      state.branches[projectId] = [...(state.branches[projectId] ?? []), branch];
      return Promise.resolve(okResponse({ data: branch }, 201));
    }
    throw new Error(`fakeClient: unexpected POST ${path}`);
  };

  // biome-ignore lint/suspicious/noExplicitAny: test stub — see the doc comment above.
  return { GET, POST } as any as ManagementApiClient;
};

const run = (state: FakeState, opts: { workspaceId: string; appName: string; stage?: string }) =>
  Effect.runPromise(
    resolveContainer(opts).pipe(Effect.provideService(ManagementClient, fakeClient(state))),
  );

describe('resolveContainer — Project resolution', () => {
  let state: FakeState;

  beforeEach(() => {
    state = newFakeState();
  });

  test('no matching project creates one', async () => {
    const result = await run(state, { workspaceId: 'ws-1', appName: 'storefront' });

    expect(result.projectId).toBe('proj-1');
    expect(state.projectCreateCalls).toBe(1);
    expect(state.projects[0]?.name).toBe('storefront');
  });

  test('adopt-oldest: several projects share the name — the oldest is adopted, none created', async () => {
    state.projects.push(
      {
        id: 'proj-newest',
        name: 'storefront',
        createdAt: new Date(3).toISOString(),
        workspace: { id: 'ws-1' },
      },
      {
        id: 'proj-oldest',
        name: 'storefront',
        createdAt: new Date(1).toISOString(),
        workspace: { id: 'ws-1' },
      },
      {
        id: 'proj-middle',
        name: 'storefront',
        createdAt: new Date(2).toISOString(),
        workspace: { id: 'ws-1' },
      },
    );

    const result = await run(state, { workspaceId: 'ws-1', appName: 'storefront' });

    expect(result.projectId).toBe('proj-oldest');
    expect(state.projectCreateCalls).toBe(0);
  });

  test('a project with the same name in a different workspace is not adopted', async () => {
    state.projects.push({
      id: 'proj-other-ws',
      name: 'storefront',
      createdAt: new Date(1).toISOString(),
      workspace: { id: 'ws-2' },
    });

    const result = await run(state, { workspaceId: 'ws-1', appName: 'storefront' });

    expect(result.projectId).toBe('proj-1');
    expect(state.projectCreateCalls).toBe(1);
  });

  test('a project with a different name is not adopted', async () => {
    state.projects.push({
      id: 'proj-other-name',
      name: 'other-app',
      createdAt: new Date(1).toISOString(),
      workspace: { id: 'ws-1' },
    });

    const result = await run(state, { workspaceId: 'ws-1', appName: 'storefront' });

    expect(result.projectId).toBe('proj-1');
    expect(state.projectCreateCalls).toBe(1);
  });

  test('workspace-id shape mismatch: a wksp_-prefixed API id still matches a bare configured id', async () => {
    state.projects.push({
      id: 'proj-existing',
      name: 'storefront',
      createdAt: new Date(1).toISOString(),
      workspace: { id: 'wksp_ws-1' },
    });

    const result = await run(state, { workspaceId: 'ws-1', appName: 'storefront' });

    expect(result.projectId).toBe('proj-existing');
    expect(state.projectCreateCalls).toBe(0);
  });
});

describe('resolveContainer — Branch resolution', () => {
  let state: FakeState;

  beforeEach(() => {
    state = newFakeState();
    state.projects.push({
      id: 'proj-1',
      name: 'storefront',
      createdAt: new Date(1).toISOString(),
      workspace: { id: 'ws-1' },
    });
  });

  test('the default stage (no stage given) creates no Branch', async () => {
    const result = await run(state, { workspaceId: 'ws-1', appName: 'storefront' });

    expect(result.projectId).toBe('proj-1');
    expect(result.branchId).toBeUndefined();
    expect(state.branchCreateCalls).toBe(0);
  });

  test('a named stage with no existing Branch creates one', async () => {
    const result = await run(state, {
      workspaceId: 'ws-1',
      appName: 'storefront',
      stage: 'staging',
    });

    expect(result.projectId).toBe('proj-1');
    expect(result.branchId).toBe('br-proj-1-1');
    expect(state.branchCreateCalls).toBe(1);
    expect(state.branches['proj-1']?.[0]?.gitName).toBe('staging');
  });

  test('a named stage with an existing Branch adopts it — create-if-absent is idempotent', async () => {
    state.branches['proj-1'] = [
      { id: 'br-existing', gitName: 'staging', createdAt: new Date(1).toISOString() },
    ];

    const result = await run(state, {
      workspaceId: 'ws-1',
      appName: 'storefront',
      stage: 'staging',
    });

    expect(result.branchId).toBe('br-existing');
    expect(state.branchCreateCalls).toBe(0);
  });

  test('a racing create (409, someone else created the Branch first) re-observes and adopts the winner', async () => {
    state.raceGitName = 'staging';

    const result = await run(state, {
      workspaceId: 'ws-1',
      appName: 'storefront',
      stage: 'staging',
    });

    expect(result.branchId).toBe('br-race-staging');
    expect(state.branchCreateCalls).toBe(1);
  });

  test('two different named stages resolve to two different Branches', async () => {
    const staging = await run(state, {
      workspaceId: 'ws-1',
      appName: 'storefront',
      stage: 'staging',
    });
    const preview = await run(state, {
      workspaceId: 'ws-1',
      appName: 'storefront',
      stage: 'pr-42',
    });

    expect(staging.branchId).not.toBe(preview.branchId);
    expect(state.branches['proj-1']).toHaveLength(2);
  });
});
