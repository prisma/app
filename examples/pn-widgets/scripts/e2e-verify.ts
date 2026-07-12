#!/usr/bin/env bun
/**
 * Resolves the pn-widgets service's deployed URL via the Management API (state
 * is hosted, not local files), then polls it until the endpoint returns
 * `{"ok":true,...}` — proving a live round trip through the Prisma Next typed
 * client: each request inserts a Widget and reads it back through the
 * contract's schema (the schema the deploy migrated the DB to). Retries
 * because a version cold-starts after deploy and a Prisma Postgres connection
 * can transiently fail right after idle, recovering on the next hit.
 *
 * Run from examples/pn-widgets: `bun scripts/e2e-verify.ts`. Requires
 * PRISMA_SERVICE_TOKEN; STACK_NAME optionally overrides the project
 * name (defaults to pn-widgets, matching the stack name the CLI deploys).
 */

// Top-level await needs module context; this script imports nothing.
export {};

const API = 'https://api.prisma.io/v1';
const POLL_DEADLINE_MS = 180_000;
const POLL_INTERVAL_MS = 6_000;

const token = process.env['PRISMA_SERVICE_TOKEN'];
if (token === undefined || token.length === 0) {
  console.error('PRISMA_SERVICE_TOKEN is required');
  process.exit(1);
}
const stack = process.env['STACK_NAME'] ?? 'pn-widgets';

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null;
}

/** GET a Management API list endpoint and return its `data` rows, validated shallowly. */
async function apiRows(pathname: string): Promise<{ [key: string]: unknown }[]> {
  const response = await fetch(`${API}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`GET ${pathname} failed: ${response.status} ${await response.text()}`);
  }
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body['data'])) return [];
  return body['data'].filter(isRecord);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const projects = await apiRows('/projects?limit=100');
const project = projects.find((p) => p['name'] === stack);
const projectId = typeof project?.['id'] === 'string' ? project['id'] : undefined;
if (projectId === undefined) fail(`No project named '${stack}' in the workspace.`);

// The post-promote endpoint domain is the servable one (the create-time domain
// is a placeholder); by the time this script runs, deploy + promote have
// completed, so the service read returns the real domain.
const services = await apiRows(`/projects/${projectId}/compute-services?limit=100`);
const service = services.find((s) => s['name'] === 'widgets');
const domain =
  typeof service?.['serviceEndpointDomain'] === 'string'
    ? service['serviceEndpointDomain']
    : undefined;
if (domain === undefined || domain.length === 0) {
  fail(`Project ${projectId} has no 'widgets' compute service with an endpoint domain.`);
}

// serviceEndpointDomain may arrive WITH the https:// scheme; tolerate either.
const url = /^https?:\/\//.test(domain) ? domain : `https://${domain}/`;
console.log(`pn-widgets URL: ${url}`);

const deadline = Date.now() + POLL_DEADLINE_MS;
let lastBody = '';
while (Date.now() < deadline) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    lastBody = await response.text();
    if (lastBody.includes('"ok":true')) {
      console.log('Round trip OK — the typed Prisma Next client inserted + read a Widget:');
      console.log(lastBody);
      process.exit(0);
    }
  } catch (error) {
    lastBody = error instanceof Error ? error.message : String(error);
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
}
console.error('Round trip never returned {"ok":true} within the deadline. Last body:');
console.error(lastBody.slice(0, 3000));
process.exit(1);
