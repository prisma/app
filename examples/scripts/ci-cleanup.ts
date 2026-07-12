#!/usr/bin/env bun
/**
 * Sweeps `<prefix>-ci-<runId>` projects and legacy stale state-store
 * projects from the CI workspace. Tears down live compute first on 409.
 * Exits non-zero only if nothing could be deleted.
 */

import {
  deleteProjectDeep,
  type HttpCall,
  isEphemeralCiProjectName,
  isLegacyStaleProjectName,
} from './ci-cleanup-utils.ts';

const API = 'https://api.prisma.io/v1';

const token = process.env['PRISMA_SERVICE_TOKEN'];
if (token === undefined || token.length === 0) {
  console.error('PRISMA_SERVICE_TOKEN is required');
  process.exit(1);
}
const prefixes = process.argv.slice(2);
if (prefixes.length === 0) {
  console.error('Usage: ci-cleanup.ts <project-name-prefix> [<prefix> ...]');
  process.exit(1);
}

interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null;
}

function toProjectRow(value: unknown): ProjectRow | undefined {
  if (!isRecord(value)) return undefined;
  const { id, name, createdAt } = value;
  if (typeof id !== 'string' || typeof name !== 'string') return undefined;
  return { id, name, createdAt: typeof createdAt === 'string' ? createdAt : '(unknown)' };
}

/** List every project in the workspace, following cursor pagination. A failure here is fatal (auth/API problems must surface). */
async function listAllProjects(): Promise<ProjectRow[]> {
  const rows: ProjectRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const query = new URLSearchParams({ limit: '100' });
    if (cursor !== undefined) query.set('cursor', cursor);
    const response = await fetch(`${API}/projects?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`GET /projects failed: ${response.status} ${await response.text()}`);
    }
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body['data'])) break;
    for (const entry of body['data']) {
      const row = toProjectRow(entry);
      if (row !== undefined) rows.push(row);
    }
    const pagination = isRecord(body['pagination']) ? body['pagination'] : undefined;
    const nextCursor = pagination?.['nextCursor'];
    if (pagination?.['hasMore'] !== true || typeof nextCursor !== 'string') break;
    cursor = nextCursor;
  }
  return rows;
}

/** The HTTP seam `deleteProjectDeep` sequences over — a thin fetch wrapper. */
const http: HttpCall = async (method, path) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: response.status, ok: response.ok, body: await response.text() };
};

const projects = await listAllProjects();
console.log(`Workspace has ${projects.length} project(s):`);
for (const project of projects) {
  console.log(`  ${project.name}  (created ${project.createdAt})`);
}

const isSweepable = (name: string): boolean =>
  isEphemeralCiProjectName(name, prefixes) || isLegacyStaleProjectName(name);

const matches = projects.filter((p) => isSweepable(p.name));
const skipped = projects.filter((p) => !isSweepable(p.name));
for (const project of skipped) {
  console.log(`Keeping "${project.name}" — not an ephemeral CI or legacy stale project.`);
}
if (matches.length === 0) {
  console.log('No ephemeral CI or legacy stale projects to sweep.');
  process.exit(0);
}

let deleted = 0;
for (const project of matches) {
  console.log(`Sweeping "${project.name}" (created ${project.createdAt})…`);
  if (await deleteProjectDeep(http, project, { log: (line) => console.error(line) })) deleted++;
}
console.log(`Swept ${deleted}/${matches.length} ephemeral CI project(s).`);

// Fail only when the sweep achieved nothing at all — one stuck project must
// not redden an otherwise green run, but a wholly-failing sweep must.
if (deleted === 0) process.exit(1);
