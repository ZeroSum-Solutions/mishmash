// DELETE /api/projects/:id removes the database row FIRST, then the project
// directory. The row deletion also takes six ON DELETE CASCADE child tables
// with it, so by the time the directory removal runs there is nothing left
// pointing at those bytes.
//
// The directory removal used to be `.catch(() => {})`. When it failed the
// route still answered `{ ok: true }`, leaving a project directory on disk
// with no row referencing it: invisible to every UI surface, unreclaimable
// without manual filesystem work, and with no log line naming it.
//
// Reporting a failed delete is NOT the fix — the delete genuinely happened,
// the row is gone. The fix is that the orphan must be diagnosable. This pins
// that: the route still succeeds, and it warns with the project id.

import express from 'express';
import type { Response } from 'express';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDatabase, deleteProject, getProject, insertProject, openDatabase } from '../src/db.js';
import { migrateLibrary } from '../src/library-store.js';
import { registerProjectRoutes, type RegisterProjectRoutesDeps } from '../src/routes/project/index.js';

type Db = ReturnType<typeof openDatabase>;

const PROJECT_ID = 'orphan-warning-proj-1';

let db: Db;
let tempDir: string;
let server: import('node:http').Server | undefined;
let baseUrl = '';
let removeProjectDir: ReturnType<typeof vi.fn>;

function mount(): Promise<void> {
  const app = express();
  app.use(express.json());
  registerProjectRoutes(app, {
    db,
    http: {
      sendApiError: (res: Response, status: number, code: string, message: string) =>
        res.status(status).json({ error: { code, message } }),
      createSseResponse: () => ({ send: vi.fn(() => true), end: vi.fn(), cleanup: vi.fn() }),
    },
    paths: {
      PROJECTS_DIR: tempDir,
      BRANDS_DIR: tempDir,
      RUNTIME_DATA_DIR: tempDir,
      LIBRARY_DIR: tempDir,
      USER_DESIGN_SYSTEMS_DIR: tempDir,
    },
    // Omitted on purpose: createWriteGateway() fails fast without it, which
    // drives the delete route's documented MM-021 fallback pathrather than
    // the materialize path. Either way the route must reach the directory
    // removal below, which is what this test is about.
    filesystem: undefined,
    appConfig: { readAppConfig: async () => ({}), writeAppConfig: async () => {} },
    projectStore: { insertProject, getProject, dbDeleteProject: deleteProject, removeProjectDir },
    projectFiles: {},
    conversations: {},
    templates: {},
    status: {},
    events: {},
    ids: { randomId: () => 'rid-orphan' },
    validation: {},
    agents: { getAgentDef: () => null },
    design: { runs: { list: () => [], cancel: async () => undefined } },
  } as unknown as RegisterProjectRoutesDeps);

  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
      resolve();
    });
  });
}

beforeEach(async () => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-orphan-warn-'));
  db = openDatabase(path.join(tempDir, 'test.db'));
  migrateLibrary(db);
  const now = new Date().toISOString();
  insertProject(db, { id: PROJECT_ID, name: 'Orphan Warning Project', createdAt: now, updatedAt: now } as never);
  removeProjectDir = vi.fn(async () => {
    throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  });
  await mount();
});

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('DELETE /api/projects/:id when the directory removal fails', () => {
  it('still deletes the row and still answers ok', async () => {
    const res = await fetch(`${baseUrl}/api/projects/${PROJECT_ID}`, { method: 'DELETE' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(removeProjectDir).toHaveBeenCalledTimes(1);
    // The row is genuinely gone — this is why the failure cannot be reported
    // as a failed delete.
    expect(getProject(db, PROJECT_ID)).toBeFalsy();
  });

  it('warns, naming the project whose files are now orphaned', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await fetch(`${baseUrl}/api/projects/${PROJECT_ID}`, { method: 'DELETE' });

    const orphanWarning = warn.mock.calls.find(
      (call) => typeof call[0] === 'string'
        && call[0].includes('[project-delete]')
        && call[0].includes('orphaned'),
    );
    // Red before the fix: the empty `.catch(() => {})` emitted nothing at all,
    // so the orphaned directory left no trace anywhere.
    expect(orphanWarning, 'expected an orphan warning naming the project').toBeTruthy();
    expect(orphanWarning![0]).toContain(PROJECT_ID);
  });
});
