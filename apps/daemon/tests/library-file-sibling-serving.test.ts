// MM-020: HTML/design-system asset cards render raw, unstyled markup. Half
// the cause is `/raw` — it serves exactly the ONE file an asset is
// registered under, so a captured page's relative refs (`href="assets/
// aura.css"`, `src="assets/subject-lateral.jpg"`) 404 against it. This spec
// pins the fix: `GET /api/library/assets/:id/file/*splat` resolves any
// requested path against the asset's own PARENT DIRECTORY instead, so an
// iframe pointed at the entry file's own `/file/<basename>` sees its
// siblings resolve the way a same-origin static server would.
//
// Real transport throughout: a real booted daemon, real HTTP requests, no
// mocked fetch/db, per VERIFICATION-CONTRACT.md R2. The asset is seeded
// directly through the store (matching library-list-pagination.test.ts) —
// `referenced` storage with real sibling files on disk, since that is the
// storage shape that actually carries a full sibling tree (design-system
// previews, project-synced HTML; see library-sync.ts).

import type http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { closeDatabase, openDatabase } from '../src/db.js';
import { insertLibraryAsset } from '../src/library-store.js';

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
let projectsDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

const ASSET_ID = 'sibling-asset-1';
const PROJECT_ID = 'sibling-proj-1';
const ENTRY_REL = 'screens/index.html';

async function seedReferencedAsset(): Promise<void> {
  const entryDir = path.join(projectsDir, PROJECT_ID, 'screens');
  await mkdir(path.join(entryDir, 'assets'), { recursive: true });
  await writeFile(
    path.join(entryDir, 'index.html'),
    '<!doctype html><link rel="stylesheet" href="assets/aura.css"><h1>Hi</h1>',
  );
  await writeFile(path.join(entryDir, 'assets', 'aura.css'), 'h1{color:red}');

  const db = openDatabase(dataDir, { dataDir });
  const now = Date.now();
  insertLibraryAsset(db, {
    id: ASSET_ID,
    kind: 'design-system',
    storage: 'referenced',
    capturedAt: now,
    archivedDate: '2024-05-01',
    contentHash: 'sibling-hash-1',
    tags: [],
    originProjectId: PROJECT_ID,
    relPath: ENTRY_REL,
    mime: 'text/html',
  });
  closeDatabase();
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-file-sibling-'));
  projectsDir = path.join(dataDir, 'projects');
  await mkdir(projectsDir, { recursive: true });
  await seedReferencedAsset();

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

it('serves the entry file at /file/<basename> with the right content-type', async () => {
  const res = await fetch(`${baseUrl}/api/library/assets/${ASSET_ID}/file/index.html`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/html');
  expect(await res.text()).toContain('<h1>Hi</h1>');
});

it('serves a sibling resource resolved against the asset\'s parent directory, with its own content-type', async () => {
  const res = await fetch(`${baseUrl}/api/library/assets/${ASSET_ID}/file/assets/aura.css`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/css');
  expect(await res.text()).toBe('h1{color:red}');
});

it('sets a CSP on the file route that allows external https and keeps object-src none', async () => {
  const res = await fetch(`${baseUrl}/api/library/assets/${ASSET_ID}/file/index.html`);
  const csp = res.headers.get('content-security-policy') ?? '';
  expect(csp).toContain('https:');
  expect(csp).toContain("object-src 'none'");
});

it('404s a sibling path that does not exist', async () => {
  const res = await fetch(`${baseUrl}/api/library/assets/${ASSET_ID}/file/assets/does-not-exist.css`);
  expect(res.status).toBe(404);
});

it('rejects an encoded-slash traversal attempt that would escape the parent directory', async () => {
  // "..%2f" is not a real "/" delimiter to Express's router — it arrives as
  // ONE opaque path segment that only becomes "../" after the route decodes
  // it, bypassing whatever dot-segment collapsing a plain literal ".." would
  // hit in fetch()'s own URL normalization.
  const res = await fetch(
    `${baseUrl}/api/library/assets/${ASSET_ID}/file/..%2f..%2f..%2f..%2f..%2fetc%2fpasswd`,
  );
  expect(res.status).toBe(404);
});

it('rejects an absolute-path attempt', async () => {
  // "%2Fetc%2Fpasswd" decodes to a single segment "/etc/passwd" — an
  // absolute path, not a path relative to the asset's parent directory.
  const res = await fetch(`${baseUrl}/api/library/assets/${ASSET_ID}/file/%2Fetc%2Fpasswd`);
  expect(res.status).toBe(404);
});

it('rejects a non-loopback origin', async () => {
  const res = await fetch(`${baseUrl}/api/library/assets/${ASSET_ID}/file/index.html`, {
    headers: { Origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  });
  expect(res.status).toBe(403);
});
