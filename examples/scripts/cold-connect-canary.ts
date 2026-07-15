#!/usr/bin/env bun
/**
 * Canary for FT-5226 (PPg cold-connect rejection). Provisions a fresh project
 * and SAMPLES several fresh cold databases: each makes ONE bare `pg` connect
 * with no retry. FT-5226 is intermittent (the edge proxy rejects a cold DB's
 * first connect while its upstream warms, but a fast connect occasionally slips
 * through), so a single connect can't tell "fixed" from "got lucky once". The
 * run is judged unanimously (see classifyColdConnectRun): any active rejection
 * → PASS (bug still present); ALL samples succeeding → FAIL, the signal to
 * remove `withConnectionRetry` (packages/compose-cloud/src/pg-connection.ts) and
 * this canary.
 */
import pg from 'pg';
import { deleteProjectDeep, type HttpCall, type ProjectRef } from './ci-cleanup-utils.ts';
import {
  type ColdConnectSample,
  classifyColdConnectRun,
  classifyColdConnectSample,
} from './cold-connect-canary-classify.ts';

const API = 'https://api.prisma.io/v1';
const REGION = 'us-east-1';
const SAMPLES = Number(process.env['COLD_CONNECT_SAMPLES'] ?? '5');

const token = process.env['PRISMA_SERVICE_TOKEN'];
const workspaceId = process.env['PRISMA_WORKSPACE_ID'];
if (!token || !workspaceId) {
  console.error('PRISMA_SERVICE_TOKEN and PRISMA_WORKSPACE_ID are required');
  process.exit(1);
}

const runId = process.env['GITHUB_RUN_ID'] ?? `${process.pid}${Math.floor(Math.random() * 1000)}`;
const projectName = `canary-ci-${runId}`;

async function api(method: string, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return fetch(`${API}${path}`, init);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function apiData(
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const res = await api(method, path, body);
  if (!res.ok) {
    throw new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`);
  }
  const json: unknown = await res.json();
  const data = isRecord(json) ? json['data'] : undefined;
  if (!isRecord(data)) {
    throw new Error(`${method} ${path} returned an unexpected body: ${JSON.stringify(json)}`);
  }
  return data;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') throw new Error(`expected "${key}" to be a string`);
  return value;
}

const http: HttpCall = async (method, path) => {
  const res = await api(method, path);
  return { status: res.status, ok: res.ok, body: await res.text() };
};

function connectionStringOf(endpoint: unknown): string | undefined {
  if (!isRecord(endpoint)) return undefined;
  const value = endpoint['connectionString'];
  return typeof value === 'string' ? value : undefined;
}

/** Provisions one fresh cold database under `projectId` and returns its first-connect outcome. */
async function sampleColdConnect(projectId: string, index: number): Promise<ColdConnectSample> {
  const createdDb = await apiData('POST', `/projects/${projectId}/databases`, {
    name: `probe${index}`,
    region: REGION,
  });
  const databaseId = requireString(createdDb, 'id');
  const createdConn = await apiData('POST', `/databases/${databaseId}/connections`, {
    name: 'canary',
  });
  const endpoints = createdConn['endpoints'];
  const dsn =
    connectionStringOf(isRecord(endpoints) ? endpoints['direct'] : undefined) ??
    connectionStringOf(isRecord(endpoints) ? endpoints['pooled'] : undefined);
  if (!dsn) throw new Error('connection returned no direct/pooled connection string');

  const client = new pg.Client({ connectionString: dsn, connectionTimeoutMillis: 10_000 });
  let connectError: unknown;
  const started = Date.now();
  try {
    await client.connect();
    await client.query('select 1');
    await client.end();
  } catch (error) {
    connectError = error;
    try {
      await client.end();
    } catch {
      // already dead
    }
  }
  const sample = classifyColdConnectSample(connectError);
  const detail = connectError instanceof Error ? ` — ${connectError.message}` : '';
  console.log(`  sample #${index}: ${sample} (${Date.now() - started}ms)${detail}`);
  return sample;
}

let project: ProjectRef | undefined;

try {
  const createdProject = await apiData('POST', '/projects', {
    name: projectName,
    workspaceId,
  });
  project = {
    id: requireString(createdProject, 'id'),
    name: requireString(createdProject, 'name'),
  };
  console.log(`Created project "${project.name}" (${project.id}); sampling ${SAMPLES} cold DBs…`);

  const samples: ColdConnectSample[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    samples.push(await sampleColdConnect(project.id, i));
  }

  const result = classifyColdConnectRun(samples);
  console.log(result.message);
  process.exitCode = result.pass ? 0 : 1;
} finally {
  if (project) {
    console.log(`Deleting project "${project.name}" (${project.id})…`);
    const deleted = await deleteProjectDeep(http, project, { log: (line) => console.error(line) });
    if (!deleted) {
      console.error(
        `Failed to delete canary project "${project.name}" (${project.id}) — check for a leak.`,
      );
    }
  }
}
