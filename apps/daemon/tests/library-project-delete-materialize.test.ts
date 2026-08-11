// MM-021: a `referenced` Library row resolves its bytes through
// PROJECTS_DIR/<originProjectId>/<relPath> (library.ts's
// resolveAssetBytesPath). DELETE /api/projects/:id never told the Library
// store about this, so a referenced row outlived the project it pointed at
// and its /raw (and /file) endpoints 404'd forever. This pins the fix:
//   - the delete route materializes each referenced row's bytes into
//     library-owned, content-addressed storage BEFORE the project directory
//     is removed, flipping the row to `owned` (bytes stay readable), and
//   - a row whose source file is already missing at delete time is marked
//     `broken` instead of failing the delete.
//
// Real transport throughout: a real booted daemon, real HTTP requests, no
// mocked fetch/db — matches library-file-sibling-serving.test.ts.

import type http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { closeDatabase, insertProject, openDatabase } from '../src/db.js';
import { insertLibraryAsset } from '../src/library-store.js';

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
let projectsDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

const PROJECT_ID = 'delete-materialize-proj-1';
const ASSET_ID = 'delete-materialize-asset-1';
const ENTRY_REL = 'render.png';
const ASSET_BYTES = 'fake-png-bytes-for-materialize-test';

async function seedProjectAndAsset(): Promise<void> {
  const dir = path.join(projectsDir, PROJECT_ID);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, ENTRY_REL), ASSET_BYTES);

  const db = openDatabase(dataDir, { dataDir });
  const now = Date.now();
  insertProject(db, { id: PROJECT_ID, name: 'Del Materialize', createdAt: now, updatedAt: now });
  insertLibraryAsset(db, {
    id: ASSET_ID,
    kind: 'image',
    storage: 'referenced',
    capturedAt: now,
    archivedDate: '2024-05-01',
    contentHash: 'delete-materialize-hash-1',
    tags: [],
    originProjectId: PROJECT_ID,
    relPath: ENTRY_REL,
    mime: 'image/png',
  });
  closeDatabase();
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-project-delete-'));
  projectsDir = path.join(dataDir, 'projects');
  await mkdir(projectsDir, { recursive: true });
  await seedProjectAndAsset();

  process.env.OD_DATA_DIR = dataDir;
  const { startServer } = await import('../src/server.js');
  const started = (await startServer({ port: 0, host: '127.0.0.1', returnServer: true })) as {
    url: string;
    server: http.Server;
    shutdown?: () => Promise<void> | void;
  };
  baseUrl = started.url;
  daemon = started.server;
  daemonShutdown = started.shutdown;
});

afterEach(async () => {
  if (daemonShutdown) {
    await Promise.race([Promise.resolve(daemonShutdown()), new Promise((r) => setTimeout(r, 2000))]);
  }
  daemon?.closeAllConnections?.();
  await new Promise<void>((resolve) => daemon?.close(() => resolve()) ?? resolve());
  if (PREV_DATA_DIR === undefined) delete process.env.OD_DATA_DIR;
  else process.env.OD_DATA_DIR = PREV_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  register.clear();
  vi.resetModules();
});

it('materializes a referenced asset into owned storage before removing the project directory, keeping bytes readable after delete', async () => {
  const before = await fetch(`${baseUrl}/api/library/assets/${ASSET_ID}`);
  expect(before.status).toBe(200);
  const beforeBody = (await before.json()) as { asset: { storage: string } };
  expect(beforeBody.asset.storage).toBe('referenced');

  const del = await fetch(`${baseUrl}/api/projects/${PROJECT_ID}`, { method: 'DELETE' });
  expect(del.status).toBe(200);

  const after = await fetch(`${baseUrl}/api/library/assets/${ASSET_ID}`);
  expect(after.status).toBe(200);
  const afterBody = (await after.json()) as {
    asset: { storage: string; broken?: boolean; originProjectId?: string };
  };
  expect(afterBody.asset.storage).toBe('owned');
  expect(afterBody.asset.broken).toBeFalsy();
  expect(afterBody.asset.originProjectId).toBeUndefined();

  // Bytes are still readable through the Library's own endpoint, even though
  // the project directory that used to hold them is gone.
  const raw = await fetch(`${baseUrl}/api/library/assets/${ASSET_ID}/raw`);
  expect(raw.status).toBe(200);
  expect(await raw.text()).toBe(ASSET_BYTES);
});

it('marks the row broken instead of failing the delete when the source file is already missing', async () => {
  // Remove just the source file (project row/dir still exist) before
  // deleting the project, simulating a referenced row whose bytes are
  // already gone by the time delete runs.
  await rm(path.join(projectsDir, PROJECT_ID, ENTRY_REL));

  const del = await fetch(`${baseUrl}/api/projects/${PROJECT_ID}`, { method: 'DELETE' });
  expect(del.status).toBe(200);

  const after = await fetch(`${baseUrl}/api/library/assets/${ASSET_ID}`);
  expect(after.status).toBe(200);
  const afterBody = (await after.json()) as { asset: { storage: string; broken?: boolean } };
  // Mark-only: the row survives as `referenced` (bytes were never copied),
  // just flagged so the UI stops rendering it as if it still resolved.
  expect(afterBody.asset.storage).toBe('referenced');
  expect(afterBody.asset.broken).toBe(true);
});
