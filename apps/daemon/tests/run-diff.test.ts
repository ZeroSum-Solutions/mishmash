// W8D / F-03 red spec item 2 — the run before/after data route.
//
// RED on base d7ff39a36 is a ROUTE-ABSENCE red, disclosed as exactly that:
// `GET /api/runs/:id/diff` is not registered, so the daemon answers 404 for a
// run id that certainly exists. Per the wave-7 audit's ruling on this shape
// (w7-spec-audit-r2.md table 2, INV-7.7 row) a route-absence red is acceptable
// when it is named honestly rather than dressed up as a deeper defect. It is
// still behavioural: the daemon boots, the run exists, the version history on
// disk exists, and the request comes back 404 instead of the before/after body.
//
// What is real production code here, and what is not:
//   - The daemon is the real daemon (`startServer`) on a fresh OD_DATA_DIR.
//   - The project, the conversation and the run are created over real HTTP.
//   - The file versions are written by `snapshotAiHtmlVersionsForRun`, the same
//     function `server.ts:5656` calls at the run's terminal chokepoint.
//   - The agent subprocess is NOT run (no agent binary in CI). That is the only
//     stub, and it is orthogonal: the route reads the version manifest and the
//     messages table, never the agent.
//
// The restart case is the load-bearing one: it stops the daemon, boots a second
// daemon on the SAME data root, and repeats the GET. A memory-backed
// implementation passes the first case and fails this one.

import type http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// See the D-18 note in `actor-attribution.test.ts`: spelled literally so RED on
// base fails on the 404 rather than on module resolution, and pinned to the
// contracts export by the last case in this file.
const ACTOR_HEADER_NAME = 'x-od-actor';

const BEFORE_HTML = '<!doctype html><title>before</title><h1>v1 body</h1>\n';
const AFTER_HTML = '<!doctype html><title>after</title><h1>v2 body</h1>\n';
const FILE_NAME = 'index.html';

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

async function bootDaemon(): Promise<void> {
  const { startServer } = await import('../src/server.js');
  const started = (await startServer({ port: 0, host: '127.0.0.1', returnServer: true })) as {
    url: string;
    server: http.Server;
    shutdown?: () => Promise<void> | void;
  };
  baseUrl = started.url;
  daemon = started.server;
  daemonShutdown = started.shutdown;
}

async function stopDaemon(): Promise<void> {
  if (daemonShutdown) {
    await Promise.race([Promise.resolve(daemonShutdown()), new Promise((r) => setTimeout(r, 2000))]);
  }
  daemon?.closeAllConnections?.();
  await new Promise<void>((resolve) => daemon?.close(() => resolve()) ?? resolve());
  daemon = undefined;
  daemonShutdown = undefined;
  register.clear();
  vi.resetModules();
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-w8d-diff-'));
  process.env.OD_DATA_DIR = dataDir;
  await bootDaemon();
}, 60_000);

afterEach(async () => {
  await stopDaemon();
  if (PREV_DATA_DIR === undefined) delete process.env.OD_DATA_DIR;
  else process.env.OD_DATA_DIR = PREV_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
}, 30_000);

interface Fixture {
  projectId: string;
  conversationId: string;
  runId: string;
  projectRoot: string;
  projectsRoot: string;
}

/**
 * Creates a project + conversation over HTTP, starts a run carrying the actor
 * header, then plays the run's file writes through the production snapshot
 * function: one untagged prior version, then the run-tagged version.
 */
async function seedRunWithTwoVersions(actor: string | null): Promise<Fixture> {
  const projectId = `w8ddiff${Math.random().toString(36).slice(2, 8)}`;
  const projectResp = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: projectId, name: 'W8D diff project' }),
  });
  expect(projectResp.status, await projectResp.clone().text()).toBeLessThan(400);

  const convResp = await fetch(`${baseUrl}/api/projects/${projectId}/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'diff' }),
  });
  expect(convResp.status, await convResp.clone().text()).toBeLessThan(400);
  const conversationId =
    ((await convResp.json()) as { conversation?: { id?: string } }).conversation?.id ?? '';
  expect(conversationId).toBeTruthy();

  const assistantMessageId = `w8d-${Math.random().toString(36).slice(2, 10)}`;
  const runResp = await fetch(`${baseUrl}/api/runs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(actor ? { [ACTOR_HEADER_NAME]: actor } : {}),
    },
    body: JSON.stringify({
      projectId,
      conversationId,
      assistantMessageId,
      message: 'edit the page',
    }),
  });
  expect(runResp.status).toBe(202);
  const runId = ((await runResp.json()) as { runId?: string }).runId ?? '';
  expect(runId).toBeTruthy();

  const projectsRoot = path.join(dataDir, 'projects');
  const projectRoot = path.join(projectsRoot, projectId);
  const filePath = path.join(projectRoot, FILE_NAME);
  // POST /api/projects records the row; the directory is created lazily by the
  // first write. An agent run would have created it, so create it here.
  await mkdir(projectRoot, { recursive: true });

  const snapshots = await import('../src/run-html-version-snapshots.js');
  // Prior version: an ordinary save with no run behind it. This is what
  // `before` must resolve to.
  await writeFile(filePath, BEFORE_HTML);
  await snapshots.snapshotAiHtmlVersionsForRun({
    projectsRoot,
    projectId,
    projectRoot,
    diff: { touchedPaths: [filePath] },
    prompt: null,
  } as Parameters<typeof snapshots.snapshotAiHtmlVersionsForRun>[0]);

  // The run's own write. On branch this carries runId + actorName.
  await writeFile(filePath, AFTER_HTML);
  await snapshots.snapshotAiHtmlVersionsForRun({
    projectsRoot,
    projectId,
    projectRoot,
    diff: { touchedPaths: [filePath] },
    prompt: 'edit the page',
    promptSource: 'message',
    runId,
    actorName: actor,
  } as Parameters<typeof snapshots.snapshotAiHtmlVersionsForRun>[0]);

  return { projectId, conversationId, runId, projectRoot, projectsRoot };
}

interface DiffBody {
  runId?: string;
  files?: Array<{
    fileName?: string;
    kind?: string;
    actorName?: string | null;
    at?: number;
    before?: { content?: string | null; id?: string } | null;
    after?: { content?: string | null; id?: string };
  }>;
}

describe('W8D: GET /api/runs/:id/diff returns disk-backed before/after content', () => {
  it('returns the before and after text of a file the run touched', async () => {
    const fixture = await seedRunWithTwoVersions('Devin');

    const resp = await fetch(`${baseUrl}/api/runs/${fixture.runId}/diff`);
    // RED on base: 404 — the route is not registered. Disclosed route-absence red.
    expect(resp.status, `body: ${await resp.clone().text()}`).toBe(200);

    const body = (await resp.json()) as DiffBody;
    expect(body.runId).toBe(fixture.runId);
    expect(body.files?.length).toBe(1);
    const entry = body.files?.[0];
    expect(entry?.fileName).toBe(FILE_NAME);
    expect(entry?.kind).toBe('html');
    expect(entry?.before?.content).toBe(BEFORE_HTML);
    expect(entry?.after?.content).toBe(AFTER_HTML);
    expect(entry?.actorName).toBe('Devin');
    expect(typeof entry?.at).toBe('number');
  });

  it('answers the same body after a daemon restart on the same data root', async () => {
    const fixture = await seedRunWithTwoVersions('Devin');

    const first = await fetch(`${baseUrl}/api/runs/${fixture.runId}/diff`);
    const firstBody = first.status === 200 ? ((await first.json()) as DiffBody) : null;

    // The run object is now gone from memory. Only disk (the version manifest
    // plus messages.run_id -> conversations.project_id) can answer.
    await stopDaemon();
    await bootDaemon();

    const second = await fetch(`${baseUrl}/api/runs/${fixture.runId}/diff`);
    expect(second.status, `body: ${await second.clone().text()}`).toBe(200);
    const secondBody = (await second.json()) as DiffBody;
    expect(secondBody.files?.[0]?.before?.content).toBe(BEFORE_HTML);
    expect(secondBody.files?.[0]?.after?.content).toBe(AFTER_HTML);
    expect(secondBody.files?.[0]?.actorName).toBe('Devin');
    expect(secondBody).toEqual(firstBody);
  }, 90_000);

  it('404s an unknown run id', async () => {
    const resp = await fetch(`${baseUrl}/api/runs/no-such-run-w8d/diff`);
    expect(resp.status).toBe(404);
    const body = (await resp.json().catch(() => ({}))) as { error?: { code?: string } };
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('reports a null actor for a run created without the header', async () => {
    const fixture = await seedRunWithTwoVersions(null);
    const resp = await fetch(`${baseUrl}/api/runs/${fixture.runId}/diff`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as DiffBody;
    expect(body.files?.[0]?.actorName ?? null).toBeNull();
    expect(body.files?.[0]?.after?.content).toBe(AFTER_HTML);
  });

  it('emits only keys the RunDiffResponse contract describes', async () => {
    const fixture = await seedRunWithTwoVersions('Devin');
    const resp = await fetch(`${baseUrl}/api/runs/${fixture.runId}/diff`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, unknown>;
    // Falsifiable property-set check: a hand-built body with extra keys fails.
    expect(Object.keys(body).sort()).toEqual(['files', 'runId']);
    const entry = (body.files as Array<Record<string, unknown>>)[0] ?? {};
    expect(Object.keys(entry).sort()).toEqual(['actorName', 'after', 'at', 'before', 'fileName', 'kind']);
  });
});

describe('W8D: the run-diff wire shape has one source of truth', () => {
  it('exports RunDiffResponse from packages/contracts', async () => {
    // Types erase at runtime, so the falsifiable check is on the module's own
    // declaration file, which `pnpm typecheck` also consumes.
    const { readFile } = await import('node:fs/promises');
    const here = path.dirname(new URL(import.meta.url).pathname);
    const decl = await readFile(
      path.resolve(here, '../../../packages/contracts/src/api/run-diff.ts'),
      'utf8',
    ).catch(() => '');
    // RED on base: the file does not exist, so this reads ''.
    expect(decl).toContain('RunDiffResponse');
    expect(decl).toContain('RunFileDiffEntry');
  });
});
