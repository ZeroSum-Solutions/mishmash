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
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { closeDatabase, insertProject, openDatabase } from '../src/db.js';
import { getLibraryAsset, insertLibraryAsset, migrateLibrary } from '../src/library-store.js';
import { materializeReferencedAsset } from '../src/library.js';
import { createFilesystemWriteGateway, type FilesystemWriteGateway } from '../src/filesystem/write-gateway.js';

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
// The row is deliberately seeded below with a fake `contentHash` that does
// NOT match these bytes — materialize must re-hash the actual source bytes
// rather than trust the stored value (adversarial finding #5).
const REAL_CONTENT_HASH = createHash('sha256').update(ASSET_BYTES, 'utf8').digest('hex');

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
    asset: { storage: string; broken?: boolean; originProjectId?: string; contentHash?: string };
  };
  expect(afterBody.asset.storage).toBe('owned');
  expect(afterBody.asset.broken).toBeFalsy();
  expect(afterBody.asset.originProjectId).toBeUndefined();
  // Re-hash, not trust: the row was seeded with a fake contentHash that
  // doesn't match ASSET_BYTES; materialize must land it at the REAL
  // hash-of-bytes and update the row's own contentHash to match (finding #5)
  // instead of writing to a stale, wrong content-addressed path.
  expect(afterBody.asset.contentHash).toBe(REAL_CONTENT_HASH);
  expect(afterBody.asset.contentHash).not.toBe('delete-materialize-hash-1');

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

// Adversarial finding #2/#5: the per-row copy step itself (not just a
// missing source) can fail — permissions, disk full, a race. Force every
// write under LIBRARY_DIR/objects to fail via a real (non-mocked) forbidden
// write-root collision, exercising the SAME catch block a `copyFile` throw
// would hit.
it('marks the row broken instead of failing the delete when the copy step itself fails', async () => {
  process.env.OD_DESIGN_LIBRARY_DIR = path.join(dataDir, 'library', 'objects');
  try {
    const del = await fetch(`${baseUrl}/api/projects/${PROJECT_ID}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
  } finally {
    delete process.env.OD_DESIGN_LIBRARY_DIR;
  }

  const after = await fetch(`${baseUrl}/api/library/assets/${ASSET_ID}`);
  expect(after.status).toBe(200);
  const afterBody = (await after.json()) as { asset: { storage: string; broken?: boolean } };
  expect(afterBody.asset.storage).toBe('referenced');
  expect(afterBody.asset.broken).toBe(true);
});

// Adversarial findings #1/#3: a TOTAL materialize failure (the write gateway
// can't be minted -- e.g. `ctx.filesystem` missing, or `runtimeData()`
// itself throwing) used to silently orphan every referenced row for the
// project instead of just the one row that failed. Force a real (non-mocked)
// `gateway.runtimeData()` failure by pointing the forbidden design-library
// root AT the runtime data root itself, then assert the delete still
// succeeds AND every referenced row for the project -- not just one -- ends
// up marked broken via the fallback path.
it('marks every referenced row for the project broken when the whole materialize pass fails, and the delete still succeeds', async () => {
  const SECOND_ASSET_ID = 'delete-materialize-asset-2';
  // The daemon (started in beforeEach) already holds the live connection to
  // this exact data dir's app.sqlite; `openDatabase` with the same resolved
  // path returns that SAME cached instance rather than opening a second one
  // (see db.ts's `dbFile === file` short-circuit). Do NOT `closeDatabase()`
  // here — that would close the connection the running daemon needs for the
  // DELETE request below.
  const db = openDatabase(dataDir, { dataDir });
  const now = Date.now();
  insertLibraryAsset(db, {
    id: SECOND_ASSET_ID,
    kind: 'image',
    storage: 'referenced',
    capturedAt: now,
    archivedDate: '2024-05-01',
    contentHash: 'delete-materialize-hash-2',
    tags: [],
    originProjectId: PROJECT_ID,
    relPath: ENTRY_REL,
    mime: 'image/png',
  });

  process.env.OD_DESIGN_LIBRARY_DIR = dataDir;
  try {
    const del = await fetch(`${baseUrl}/api/projects/${PROJECT_ID}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
  } finally {
    delete process.env.OD_DESIGN_LIBRARY_DIR;
  }

  for (const id of [ASSET_ID, SECOND_ASSET_ID]) {
    const after = await fetch(`${baseUrl}/api/library/assets/${id}`);
    expect(after.status).toBe(200);
    const body = (await after.json()) as { asset: { storage: string; broken?: boolean } };
    // Still `referenced` (the fallback marks directly, it never materializes)
    // but flagged broken so the UI stops treating it as resolvable.
    expect(body.asset.storage).toBe('referenced');
    expect(body.asset.broken).toBe(true);
  }
});

// Adversarial finding #2/#5, unit-style: precisely inject a gateway whose
// `copyFile` throws (mkdir still succeeds) and confirm `materializeReferencedAsset`
// itself -- independent of the HTTP delete route -- returns `copy-failed` and
// actually calls through to mark the row broken (not just count it, per
// finding #2's original bug).
describe('materializeReferencedAsset — copyFile throws', () => {
  it('returns copy-failed and marks the row broken when the gateway copyFile call throws', async () => {
    const db = new Database(':memory:');
    migrateLibrary(db);
    const libraryDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-materialize-copyfail-'));
    const unitProjectsDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-materialize-copyfail-src-'));
    try {
      const originProjectId = 'copyfail-proj-1';
      const relPath = 'render.png';
      await mkdir(path.join(unitProjectsDir, originProjectId), { recursive: true });
      await writeFile(path.join(unitProjectsDir, originProjectId, relPath), ASSET_BYTES);

      const now = Date.now();
      insertLibraryAsset(db, {
        id: 'copyfail-asset-1',
        kind: 'image',
        storage: 'referenced',
        capturedAt: now,
        archivedDate: '2024-05-01',
        contentHash: 'copyfail-hash-1',
        tags: [],
        originProjectId,
        relPath,
        mime: 'image/png',
      });
      const asset = getLibraryAsset(db, 'copyfail-asset-1')!;

      const realGateway = createFilesystemWriteGateway({ runtimeDataRoot: libraryDir });
      const realCapability = await realGateway.runtimeData();
      // Delegate every gateway method to the real, working implementation
      // EXCEPT copyFile, which is injected to throw -- mkdir must still
      // succeed so this exercises the copy step specifically, distinct from
      // the "whole materialize pass fails" fallback (findings #1/#3, tested
      // above via the HTTP route).
      const throwingGateway: FilesystemWriteGateway = {
        mkdir: realGateway.mkdir.bind(realGateway),
        writeFile: realGateway.writeFile.bind(realGateway),
        appendFile: realGateway.appendFile.bind(realGateway),
        copyFile: async () => {
          throw new Error('injected copyFile failure');
        },
        rename: realGateway.rename.bind(realGateway),
        rm: realGateway.rm.bind(realGateway),
        unlink: realGateway.unlink.bind(realGateway),
        createWriteStream: realGateway.createWriteStream.bind(realGateway),
        runtimeData: realGateway.runtimeData.bind(realGateway),
        managedProject: realGateway.managedProject.bind(realGateway),
        importedProject: realGateway.importedProject.bind(realGateway),
        backupDestination: realGateway.backupDestination.bind(realGateway),
        mediaConfig: realGateway.mediaConfig.bind(realGateway),
        temp: realGateway.temp.bind(realGateway),
        externalTool: realGateway.externalTool.bind(realGateway),
        cliOutput: realGateway.cliOutput.bind(realGateway),
      } as unknown as FilesystemWriteGateway;

      const result = await materializeReferencedAsset(
        db,
        asset,
        libraryDir,
        unitProjectsDir,
        { gateway: throwingGateway, capability: realCapability },
      );

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('copy-failed');
      const row = getLibraryAsset(db, 'copyfail-asset-1');
      expect(row?.broken).toBe(true);
    } finally {
      db.close();
      await rm(libraryDir, { recursive: true, force: true }).catch(() => {});
      await rm(unitProjectsDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
