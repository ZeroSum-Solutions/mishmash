// Red spec for W7C work item 1/2 (DEF-7.3, INV-7.6): the daemon currently
// answers /wait, the project task list, and (not at all) cancel with THREE
// different ad-hoc shapes instead of one contracts-owned MediaTaskSnapshot.
//
// On base (8487362f0):
//   - `GET /api/projects/:id/media/tasks` projects a fourth shape
//     (routes/media.ts ~768-784: `elapsed`, `progressCount`, `progress`
//     truncated to the last 3 lines, no `nextSince`) instead of the same
//     snapshot `/wait` returns.
//   - `POST /api/media/tasks/:id/cancel` does not exist at all (404).
//
// Both assertions below are behavioural (a body-shape mismatch, a 404),
// not import failures — this file only imports modules that already exist
// on base. The `isMediaTaskSnapshot` / `MediaTaskListResponse` contracts
// guard is added in the first FIX commit once those exports exist, never
// here, per builder-protocol.md:43-48.

import type http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { closeDatabase, insertProject, openDatabase } from '../../src/db.js';
import { insertMediaTask } from '../../src/media/tasks.js';
import { startServer } from '../../src/server.js';

describe('media task contract — /wait, the list route, and cancel agree on one shape', () => {
  let server: http.Server | null = null;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = null;
    }
    closeDatabase();
  });

  it('lists the SAME snapshot shape /wait returns, not a fourth ad-hoc projection', async () => {
    const dataDir = process.env.OD_DATA_DIR;
    const db = openDatabase(process.cwd(), dataDir === undefined ? {} : { dataDir });
    const projectId = `project_${randomUUID()}`;
    const taskId = `task_${randomUUID()}`;
    const now = Date.now() - 5_000;

    insertProject(db, { id: projectId, name: 'contract project', createdAt: now, updatedAt: now });
    insertMediaTask(db, {
      id: taskId,
      projectId,
      status: 'done',
      surface: 'video',
      model: 'ffmpeg-encode',
      progress: ['probing input', 'encoding 25%', 'encoding 50%', 'encoding 100%', 'encode finished'],
      file: { name: 'out.mp4', path: 'out.mp4', size: 2048, mtime: now, kind: 'video', mime: 'video/mp4' },
      startedAt: now,
      endedAt: now + 1_000,
      updatedAt: now + 1_000,
    });

    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    const waitResp = await fetch(`${started.url}/api/media/tasks/${encodeURIComponent(taskId)}/wait`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ since: 0, timeoutMs: 0 }),
    });
    expect(waitResp.status).toBe(200);
    const waitBody = (await waitResp.json()) as Record<string, unknown>;

    const listResp = await fetch(
      `${started.url}/api/projects/${encodeURIComponent(projectId)}/media/tasks?includeDone=1`,
    );
    expect(listResp.status).toBe(200);
    const listBody = (await listResp.json()) as { tasks: Array<Record<string, unknown>> };
    const listed = listBody.tasks.find((t) => t.taskId === taskId);
    expect(listed, 'the list route must key its entries by taskId, same as /wait').toBeDefined();

    // RED on base: the list route truncates `progress` to the last 3 lines,
    // adds `elapsed`/`progressCount`, and omits `nextSince` — a different
    // shape than the /wait snapshot. Once work item 2 makes both routes
    // build the same MediaTaskSnapshot, this equality holds.
    expect(listed).toEqual(waitBody);
  });

  it('answers something other than 404 for POST /api/media/tasks/:id/cancel', async () => {
    const dataDir = process.env.OD_DATA_DIR;
    const db = openDatabase(process.cwd(), dataDir === undefined ? {} : { dataDir });
    const projectId = `project_${randomUUID()}`;
    const taskId = `task_${randomUUID()}`;
    const now = Date.now();

    insertProject(db, { id: projectId, name: 'cancel project', createdAt: now, updatedAt: now });
    insertMediaTask(db, {
      id: taskId,
      projectId,
      status: 'running',
      surface: 'video',
      model: 'ffmpeg-encode',
      progress: ['probing input'],
      startedAt: now,
      updatedAt: now,
    });

    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    // RED on base: the route does not exist yet — every daemon route
    // Express hasn't registered falls through to its 404 handler.
    const resp = await fetch(`${started.url}/api/media/tasks/${encodeURIComponent(taskId)}/cancel`, {
      method: 'POST',
    });
    expect(resp.status, 'POST /api/media/tasks/:id/cancel must exist (work item 2)').not.toBe(404);
  });

  it('the pre-restart interrupted case (existing reconcile path) already validates as a task snapshot', async () => {
    // VERIFIED on base by construction: reconcileMediaTasksOnBoot and the
    // /wait route's interrupted-status handling both predate this track
    // (apps/daemon/tests/media/tasks-routes.test.ts already covers this
    // exact scenario). Kept here so tasks-contract.test.ts alone proves the
    // interrupted shape survives once the two ad-hoc routes above are
    // unified onto MediaTaskSnapshot.
    const dataDir = process.env.OD_DATA_DIR;
    const db = openDatabase(process.cwd(), dataDir === undefined ? {} : { dataDir });
    const projectId = `project_${randomUUID()}`;
    const taskId = `task_${randomUUID()}`;
    const now = Date.now() - 5_000;

    insertProject(db, { id: projectId, name: 'restart contract project', createdAt: now, updatedAt: now });
    insertMediaTask(db, {
      id: taskId,
      projectId,
      status: 'running',
      surface: 'video',
      model: 'seedance-2',
      progress: ['provider task accepted'],
      startedAt: now,
      updatedAt: now,
    });

    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    server = started.server;

    const resp = await fetch(`${started.url}/api/media/tasks/${encodeURIComponent(taskId)}/wait`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ since: 0, timeoutMs: 0 }),
    });
    const body = (await resp.json()) as { status?: string; error?: { code?: string } };
    expect(resp.status).toBe(200);
    expect(body.status).toBe('interrupted');
    expect(body.error?.code).toBe('DAEMON_RESTART');
  });
});
