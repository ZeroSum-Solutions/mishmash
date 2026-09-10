// W8B work item 4 (the track's primary red): a running Vimeo import cannot
// be canceled.
//
// Two independent reasons on base, both exercised here through the real HTTP
// surface a user reaches:
//
//  1. `POST /api/media/tasks/:id/cancel` (routes/media.ts:842-874) refuses
//     every video-import task at its :859 gate. The route reads the daemon's
//     ONE shared media-task store, while video-import owns a SECOND store
//     instance (video-import/service.ts:76). Both persist to the same
//     `media_tasks` row, but `kind` is in-memory only and never persisted
//     (media/task-store.ts:24-31), so the shared store's hydrated copy always
//     has `kind: undefined` and the gate refuses with 409 NOT_CANCELABLE.
//  2. Even if it were allowed, nothing would stop: the download's
//     AbortController is private to `downloadVimeoVideoToStaging`
//     (video-import/providers/vimeo.ts:222) and video-import never registers
//     anything on jobs.ts's module-level `activeJobs` kill map.
//
// RED on base: the cancel call answers 409 with `error.code:
// 'NOT_CANCELABLE'` — a real route response about the real symptom, not a
// compile error (every module this file imports exists on base) and not a
// timeout (the assertion fires on the first cancel response).
//
// GREEN on branch: 200, and the job reaches `status: 'failed'` with
// `error.code: 'CANCELED'`; the download is genuinely stopped — no project
// file was written and the staging temp file is gone.

import http from 'node:http';
import type { Server } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, insertProject, openDatabase } from '../src/db.js';
import { startServer } from '../src/server.js';
import { FileVideoImportCredentialStore } from '../src/video-import/credentials.js';

type StartedServer = { url: string; server: Server };

const ENV_KEYS = [
  'OD_VIMEO_CLIENT_ID',
  'OD_VIMEO_CLIENT_SECRET',
  'VIMEO_CLIENT_ID',
  'VIMEO_CLIENT_SECRET',
  'OD_VIMEO_API_BASE_URL',
  'OD_VIDEO_IMPORT_TIMEOUT_MS',
] as const;

const savedEnv: Record<string, string | undefined> = {};

let daemon: Server | undefined;
let baseUrl = '';
let vimeoStub: http.Server | undefined;
let dataDir = '';
let projectId = '';
/** Set once the stub has begun streaming the (never-ending) download body. */
let downloadStarted = false;

function stagingDir(): string {
  return path.join(dataDir, 'video-import', 'staging');
}

function projectDir(): string {
  return path.join(dataDir, 'projects', projectId);
}

function stagingFiles(): string[] {
  try {
    return fs.readdirSync(stagingDir());
  } catch {
    return [];
  }
}

function projectFiles(): string[] {
  try {
    return fs.readdirSync(projectDir());
  } catch {
    return [];
  }
}

async function startVimeoStub(): Promise<string> {
  // Two roles on one origin: the metadata API the service calls first, and
  // the progressive download link that metadata hands back. The download
  // writes headers and one chunk, then never ends the body — a stalled
  // upstream read, the same shape video-import-vimeo-timeout.test.ts:29-40
  // uses, so the import stays `running` for the whole test instead of
  // racing to completion.
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname.startsWith('/videos/')) {
      const address = server.address();
      const port = address && typeof address !== 'string' ? address.port : 0;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          name: 'Cancelable Fixture Clip',
          size: 4096,
          download: [{ quality: 'source', size: 4096, link: `http://127.0.0.1:${port}/download/clip.mp4` }],
        }),
      );
      return;
    }
    if (url.pathname.startsWith('/download/')) {
      res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '4096' });
      res.write(Buffer.alloc(16, 1));
      downloadStarted = true;
      return; // never ends the body
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  vimeoStub = server;
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('vimeo stub has no address');
  return `http://127.0.0.1:${address.port}`;
}

beforeEach(async () => {
  downloadStarted = false;
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  dataDir = process.env.OD_DATA_DIR ?? '';
  if (!dataDir) throw new Error('OD_DATA_DIR is required for daemon route tests');

  const stubBase = await startVimeoStub();
  process.env.OD_VIMEO_CLIENT_ID = 'cancel-fixture-id';
  process.env.OD_VIMEO_CLIENT_SECRET = 'cancel-fixture-secret';
  process.env.OD_VIMEO_API_BASE_URL = stubBase;
  // Far longer than this test runs: a cancel must end the job, never the
  // download's own deadline.
  process.env.OD_VIDEO_IMPORT_TIMEOUT_MS = '600000';

  // A connected Vimeo account, written through the daemon's own credential
  // store rather than a hand-rolled JSON blob (the module exists on base).
  new FileVideoImportCredentialStore(dataDir).set({
    schemaVersion: 1,
    provider: 'vimeo',
    accessToken: 'cancel-fixture-access-token',
    updatedAt: new Date().toISOString(),
  });

  const db = openDatabase(process.cwd(), { dataDir });
  projectId = `project_${randomUUID()}`;
  const now = Date.now();
  insertProject(db, { id: projectId, name: 'video import cancel project', createdAt: now, updatedAt: now });

  const started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
  daemon = started.server;
  baseUrl = started.url;
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await new Promise<void>((resolve) => {
    if (!daemon) return resolve();
    daemon.close(() => resolve());
  });
  daemon = undefined;
  await new Promise<void>((resolve) => {
    if (!vimeoStub) return resolve();
    vimeoStub.closeAllConnections?.();
    vimeoStub.close(() => resolve());
  });
  vimeoStub = undefined;
  closeDatabase();
  new FileVideoImportCredentialStore(dataDir).delete('vimeo');
  fs.rmSync(stagingDir(), { recursive: true, force: true });
});

async function waitFor(predicate: () => boolean, budgetMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

describe('a running Vimeo import is cancelable through the shared media-task cancel route (INV-7.6)', () => {
  it('answers 200, ends the task CANCELED, and actually stops the download', async () => {
    const createRes = await fetch(`${baseUrl}/api/projects/${projectId}/video-imports`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'vimeo', url: 'https://vimeo.com/123456789' }),
    });
    const createText = await createRes.text();
    expect(createRes.status, createText).toBe(202);
    const created = JSON.parse(createText) as { job: { jobId: string; taskId: string; status: string } };
    const { taskId, jobId } = created.job;
    expect(typeof taskId).toBe('string');

    // The download is in flight before the cancel is sent, so this exercises
    // the real running-job path rather than the pre-registration window the
    // brief discloses as still open.
    expect(await waitFor(() => downloadStarted), 'the stub must have started streaming the body').toBe(true);

    const cancelRes = await fetch(`${baseUrl}/api/media/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: 'POST',
    });
    const cancelBody = (await cancelRes.json()) as Record<string, any>;
    expect(
      cancelRes.status,
      `RED on base: 409 NOT_CANCELABLE (${JSON.stringify(cancelBody?.error ?? cancelBody)})`,
    ).toBe(200);

    // Not merely "not 409": the job must reach a terminal CANCELED state.
    let job: Record<string, any> | null = null;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const res = await fetch(`${baseUrl}/api/projects/${projectId}/video-imports/${encodeURIComponent(jobId)}`);
      const body = (await res.json()) as { job?: Record<string, any> };
      job = body.job ?? null;
      if (job && (job.status === 'failed' || job.status === 'done' || job.status === 'interrupted')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(job?.status, 'a canceled import ends failed, not stuck running').toBe('failed');
    expect(job?.error?.code, 'the terminal error names the cancel, not a timeout or upstream failure').toBe(
      'CANCELED',
    );

    // Genuinely stopped: no bytes landed in the project and the staging temp
    // file was removed.
    expect(projectFiles(), 'a canceled import must not write a project file').toEqual([]);
    expect(await waitFor(() => stagingFiles().length === 0), 'the staging temp file must be gone').toBe(true);
  });
});
