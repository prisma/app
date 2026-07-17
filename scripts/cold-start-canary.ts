#!/usr/bin/env bun
/**
 * Canary for PRO-217 (the Compute ingress closing a first-touch connection
 * while a scale-to-zero service boots) — the Compute sibling of
 * cold-connect-canary.ts, run as the VERIFY step of a deploy-verify-destroy
 * round over examples/streams (the deploy and teardown are the action's; this
 * script only samples).
 *
 * Shape: A fetches B — the deployed `jobs` service appends to the streams
 * service on every POST /jobs, un-retried (no idempotency key). Each sample
 * forces a genuinely fresh streams instance (create a deployment, upload the
 * artifact, start it, promote it to the app's stable endpoint), fires ONE
 * first-touch POST /jobs the instant the promote call succeeds, then reads
 * the deployment's own boot logs to confirm the touch actually raced the
 * boot — not just that a fresh instance existed somewhere.
 *
 * That log check exists because two earlier designs both produced false
 * signals without it:
 *
 * 1. Waiting for the promoted version to report `running` before touching it
 *    (the original design) gives the boot window time to close: `running`
 *    can flip within ~1s of `start`, well before the app itself is listening
 *    (observed boot time end-to-end: ~2-10s depending on how much state the
 *    streams module restores from the object store), so every touch after
 *    that wait lands on an already-warm process. A follow-up that added
 *    three probes at 0/2.5/5s after promote didn't fix this either — it just
 *    added more delay on top of a promote call that had already let the
 *    window close.
 * 2. Stopping the promoted deployment and touching it — a Management API
 *    `/deployments/{id}/stop` looked like a cleaner trigger than promoting a
 *    new version each sample. Verified live and it doesn't work: a stopped
 *    deployment does not revive on the next request. The app's stable
 *    endpoint just 404s (a plain HTML "Not Found", not the PRO-217 close)
 *    and stays down until something explicitly calls `start` again — so
 *    "stop, then touch" cannot trigger a cold start at all; it's a dead end,
 *    not a shortcut.
 *
 * What does work: create a new deployment, start it, and — instead of
 * waiting for `running` — race the promote call itself (retrying immediately
 * on the 409 "not running yet" it returns before the VM is up), then fire the
 * touch the instant promote succeeds. That still doesn't, by itself, prove
 * the touch beat the boot — so every touch's evidence is checked against the
 * deployment's own logs (`/deployments/{id}/logs`, read from the start):
 * spark's `starting bun with entrypoint: bootstrap.js` line marks the boot
 * beginning, and the streams server's own `listening on 0.0.0.0:…` line
 * marks the moment it can answer anything. A touch sent before that
 * `listening` line is a genuine cold-start observation; a touch sent after
 * it landed on an already-up process and carries no information about
 * PRO-217 either way (see cold-start-canary-classify.ts's `ColdStartTouch`
 * for the exact three-way split, and gotchas.md's PRO-217 entry for the run
 * that skipped this check and reported "fixed" from four warm hits).
 *
 * A REQUIRED check: any close → exit 0, bug still present (today's normal);
 * every touch reaching a genuine cold start AND holding → exit 1, the
 * forcing signal to remove createStreamsClient's IDEMPOTENT_BACKOFF
 * (PRO-219) and this canary; a run that never manages to force a cold start
 * → exit 0 with a CI warning annotation (a broken/inconclusive canary run,
 * not a clean bill of health), so a deploy flake never blocks unrelated PRs.
 */
import { execSync } from 'node:child_process';
import * as os from 'node:os';
import {
  type ColdStartTouch,
  classifyColdStartRun,
  classifyColdStartTouch,
  findListeningTimestamp,
  touchRacedBoot,
} from './cold-start-canary-classify.ts';

const API = 'https://api.prisma.io/v1';
const SAMPLES = Number(process.env['COLD_START_SAMPLES'] ?? '4');
/**
 * The streams module seals segments every 5s and uploads them to the store; a
 * fresh instance bootstraps from what the store holds. Sample too soon after
 * the warmup and the fresh instance restores a world without the canary's
 * stream — every touch 404s (observed on this canary's first live round).
 */
const DURABILITY_WAIT_MS = Number(process.env['COLD_START_DURABILITY_WAIT_MS'] ?? '10000');
/**
 * How long to read a fresh deployment's boot logs before giving up on
 * finding the `listening` line. Historical log delivery over the WebSocket
 * (`?from_start=true`) is near-instant once connected — this is headroom for
 * connection setup and an unusually slow boot, not the expected wait.
 */
const LOG_READ_TIMEOUT_MS = Number(process.env['COLD_START_LOG_READ_TIMEOUT_MS'] ?? '8000');
/**
 * Fallback only: used when the deployment's logs can't be read at all (a WS
 * failure, not merely a slow boot). gotchas.md puts a warm response well
 * under 700ms and the boot window at ~3.5-8s; this sits above the warm
 * ceiling so a latency-only read stays conservative about calling something
 * a cold start.
 */
const LATENCY_FALLBACK_THRESHOLD_MS = 1_000;

const token = process.env['PRISMA_SERVICE_TOKEN'];
const stackName = process.env['STACK_NAME'];
if (!token || !stackName) {
  console.error('PRISMA_SERVICE_TOKEN and STACK_NAME are required');
  process.exit(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface ApiResponse {
  readonly status: number;
  readonly data: unknown;
}

/** POSTs/GETs the Management API, returning the status alongside the parsed `data` field — never throws on a non-2xx status. */
async function apiCall(method: string, path: string, body?: unknown): Promise<ApiResponse> {
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, init);
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  return { status: res.status, data: isRecord(json) ? json['data'] : json };
}

/** Same as apiCall, but throws on a non-2xx status — for calls this script cannot proceed without. */
async function apiData(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await apiCall(method, path, body);
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`${method} ${path} failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

function requireString(record: unknown, key: string): string {
  if (!isRecord(record) || typeof record[key] !== 'string') {
    throw new Error(`expected "${key}" to be a string`);
  }
  return record[key];
}

/** The per-run project shares the stack's name (`prisma-composer deploy --name`). */
async function findProjectId(): Promise<string> {
  const projects = await apiData('GET', '/projects?limit=100');
  const list = Array.isArray(projects) ? projects : [];
  const match = list.find((p) => isRecord(p) && p['name'] === stackName);
  if (match === undefined) throw new Error(`no project named "${stackName}" — did the deploy run?`);
  return requireString(match, 'id');
}

interface Apps {
  readonly jobsUrl: string;
  readonly streamsAppId: string;
}

/** `/v1/apps` is the current Management API surface for what used to be `/v1/compute-services` (same underlying resources, verified live — see gotchas.md's PRO-217 entry). */
async function findApps(projectId: string): Promise<Apps> {
  const apps = await apiData('GET', `/apps?projectId=${projectId}&limit=100`);
  const list = Array.isArray(apps) ? apps : [];
  let jobsUrl: string | undefined;
  let streamsAppId: string | undefined;
  for (const app of list) {
    if (!isRecord(app)) continue;
    if (app['name'] === 'jobs') jobsUrl = requireString(app, 'appEndpointDomain');
    if (app['name'] === 'streams.service') streamsAppId = requireString(app, 'id');
  }
  if (!jobsUrl || !streamsAppId) {
    throw new Error(`stack "${stackName}" is missing the jobs/streams apps`);
  }
  return { jobsUrl, streamsAppId };
}

/**
 * The deploy that just ran left the content-addressed streams artifact in the
 * runner's temp dir (packageComputeArtifact) — reuse it so every promoted
 * deployment is byte-identical to the deployed one.
 */
function findStreamsArtifact(): string {
  const dir = `${os.tmpdir()}/prisma-composer-compute-${os.userInfo().uid}`;
  const found = execSync(`ls -t ${dir}/*/streams.service.tar.gz 2>/dev/null | head -1`, {
    encoding: 'utf8',
  }).trim();
  if (!found) throw new Error(`no streams.service.tar.gz under ${dir} — did the deploy build?`);
  return found;
}

/**
 * Reads a deployment's boot log from the start, stopping as soon as the
 * app's own `listening` line has been seen (or LOG_READ_TIMEOUT_MS elapses,
 * or the socket errors/closes). Returns the concatenated log text collected
 * so far — `findListeningTimestamp` on the result may still be undefined if
 * the line was never seen.
 */
function readDeploymentBootLog(deploymentId: string): Promise<string> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    let settled = false;
    const ws = new WebSocket(
      `wss://api.prisma.io/v1/deployments/${deploymentId}/logs?from_start=true`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.close();
      resolve(chunks.join(''));
    };
    const timer = setTimeout(finish, LOG_READ_TIMEOUT_MS);
    ws.addEventListener('message', (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (isRecord(parsed) && parsed['type'] === 'log' && typeof parsed['text'] === 'string') {
        chunks.push(parsed['text']);
        if (findListeningTimestamp(chunks.join('')) !== undefined) finish();
      }
    });
    ws.addEventListener('error', finish);
    ws.addEventListener('close', finish);
  });
}

/**
 * One fresh streams deployment, touched once: create → upload → start → race
 * the promote call (retrying immediately on the "not running yet" 409 — NOT
 * polling for `running` and then promoting, which is what let the boot
 * window close in the original design; see the module doc comment) → fire
 * the touch the instant promote succeeds → confirm from the deployment's own
 * boot log whether the touch actually landed before the app was listening.
 */
async function sampleFreshStart(
  jobsUrl: string,
  streamsAppId: string,
  artifactPath: string,
  index: number,
): Promise<ColdStartTouch> {
  const created = await apiData('POST', `/apps/${streamsAppId}/deployments`, {
    portMapping: { http: 3000 },
  });
  const deploymentId = requireString(created, 'id');
  const uploadUrl = requireString(created, 'uploadUrl');
  const artifact = await Bun.file(artifactPath).arrayBuffer();
  const uploaded = await fetch(uploadUrl, { method: 'PUT', body: artifact });
  if (!uploaded.ok) throw new Error(`artifact upload failed: ${uploaded.status}`);

  await apiData('POST', `/deployments/${deploymentId}/start`);

  const promoteDeadline = Date.now() + 30_000;
  for (;;) {
    const res = await apiCall('POST', `/apps/${streamsAppId}/promote`, { deploymentId });
    if (res.status === 200) break;
    if (res.status !== 409 || Date.now() > promoteDeadline) {
      throw new Error(
        `promote never succeeded for deployment ${deploymentId}: ${res.status} ` +
          JSON.stringify(res.data),
      );
    }
    // A short, deliberate courtesy delay — not a "wait for running" poll.
    // Each retry is still racing to promote at the earliest legal moment;
    // this just keeps a slow boot from hammering the API every few ms.
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const touchSentAt = new Date();
  const started = Date.now();
  const res = await fetch(`${jobsUrl}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'canary', touch: `${index}` }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.text();
  const latencyMs = Date.now() - started;

  const logText = await readDeploymentBootLog(deploymentId);
  const listeningAt = findListeningTimestamp(logText);
  const coldStartConfirmed =
    listeningAt !== undefined
      ? touchRacedBoot(touchSentAt, listeningAt)
      : latencyMs >= LATENCY_FALLBACK_THRESHOLD_MS;
  const evidence =
    listeningAt !== undefined
      ? `logs: listening ${listeningAt.toISOString()}, touch sent ${touchSentAt.toISOString()}`
      : `latency fallback: no listening line read within ${LOG_READ_TIMEOUT_MS}ms`;

  const touch = classifyColdStartTouch(res.status, body, coldStartConfirmed);
  const detail = touch === 'other' ? ` — ${body.slice(0, 160)}` : '';
  console.log(
    `  sample #${index}: ${touch} (${res.status}, ${latencyMs}ms) [${evidence}]${detail}`,
  );
  return touch;
}

const projectId = await findProjectId();
const { jobsUrl, streamsAppId } = await findApps(projectId);
const artifactPath = findStreamsArtifact();
console.log(`Stack "${stackName}" (${projectId}); jobs at ${jobsUrl}`);

// Warm the CALLER and create the stream, so every sample's failure can only
// come from the fresh streams instance — not from jobs' own cold start or the
// retried (idempotent) create path. A few attempts: the very first CI touch
// can meet BOTH services cold at once, which is not what this canary samples.
let warmed = false;
for (let attempt = 1; attempt <= 3 && !warmed; attempt++) {
  const warm = await fetch(`${jobsUrl}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'canary', touch: `warmup-${attempt}` }),
    signal: AbortSignal.timeout(90_000),
  });
  if (warm.status === 201) warmed = true;
  else {
    console.error(
      `  warmup attempt ${attempt}: ${warm.status} ${(await warm.text()).slice(0, 160)}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
if (!warmed) {
  console.error('warmup never succeeded — the stack is unhealthy; not a PRO-217 verdict.');
  process.exit(1);
}
console.log(
  `Warmed up; waiting ${DURABILITY_WAIT_MS}ms for the stream to reach the store, ` +
    `then sampling ${SAMPLES} fresh streams instances…`,
);
await new Promise((resolve) => setTimeout(resolve, DURABILITY_WAIT_MS));

const touches: ColdStartTouch[] = [];
for (let i = 0; i < SAMPLES; i++) {
  touches.push(await sampleFreshStart(jobsUrl, streamsAppId, artifactPath, i));
}

const result = classifyColdStartRun(touches);
console.log(result.message);
if (result.verdict === 'inconclusive') {
  // A GitHub Actions warning annotation: loud on the run page without
  // failing a required check over a deploy flake. Newlines must be %0A.
  const detail = touches.map((touch, i) => `sample #${i}: ${touch}`).join('; ');
  console.log(
    `::warning title=Cold-start canary (PRO-217) inconclusive::${result.message} [${detail}]`,
  );
}
process.exitCode = result.verdict === 'bug-gone' ? 1 : 0;
