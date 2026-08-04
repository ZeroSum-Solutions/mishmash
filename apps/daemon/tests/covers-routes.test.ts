// POST /api/projects/:id/cover/generate + GET /api/projects/:id/cover --
// real booted daemons, real HTTP requests, real Chromium renders. Mirrors
// the backup-http-routes.test.ts pattern: no mocked transport.

import type http from 'node:http';
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-covers-http-'));
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
}, 60_000); // vi.resetModules() (required for a fresh RUNTIME_DATA_DIR per test) forces a full re-transform of server.ts's module graph every time; comfortably exceeds vitest's 10s default hook timeout in this environment

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
  // server.ts resolves RUNTIME_DATA_DIR/PROJECTS_DIR at module-top-level
  // from process.env.OD_DATA_DIR; Node's dynamic import() cache means a
  // later beforeEach's re-import would otherwise silently reuse THIS
  // test's stale paths instead of its own fresh OD_DATA_DIR (the same
  // reason backup-http-routes.test.ts resets modules on every re-import).
  vi.resetModules();
}, 30_000);

async function createProject(id: string): Promise<void> {
  const resp = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name: id }),
  });
  expect(resp.ok).toBe(true);
}

async function uploadFile(projectId: string, fileName: string, content: string | Buffer, mime = 'text/html'): Promise<void> {
  const form = new FormData();
  form.append('files', new Blob([content], { type: mime }), fileName);
  const resp = await fetch(`${baseUrl}/api/projects/${projectId}/upload`, { method: 'POST', body: form });
  expect(resp.ok).toBe(true);
}

interface GenerateSuccess {
  ok: true;
  cover: { path: string; generatedAt: string; sourceHash: string; width: number; height: number };
}

describe('POST /api/projects/:id/cover/generate + GET /api/projects/:id/cover', () => {
  it(
    'generates a cover, persists it, and GET returns identical bytes after a fresh daemon boot on the same data dir',
    async () => {
      const id = `cover-persist-${Date.now()}`;
      await createProject(id);
      await uploadFile(id, 'index.html', '<!doctype html><html><body style="background:#4477ff;height:400px"></body></html>');

      const genResp = await fetch(`${baseUrl}/api/projects/${id}/cover/generate`, { method: 'POST' });
      expect(genResp.status).toBe(200);
      const genBody = (await genResp.json()) as GenerateSuccess;
      expect(genBody.ok).toBe(true);
      expect(genBody.cover.width).toBe(1280);
      expect(genBody.cover.height).toBe(800);
      expect(genBody.cover.sourceHash.length).toBeGreaterThanOrEqual(8);
      expect(typeof genBody.cover.generatedAt).toBe('string');
      expect(Number.isNaN(Date.parse(genBody.cover.generatedAt))).toBe(false);

      const getResp1 = await fetch(`${baseUrl}/api/projects/${id}/cover`);
      expect(getResp1.status).toBe(200);
      const bytesBefore = Buffer.from(await getResp1.arrayBuffer());
      expect(bytesBefore.length).toBeGreaterThan(0);

      // Restart the daemon on the SAME data dir -- the stored cover must
      // survive without re-rendering (C4-1).
      if (daemonShutdown) await daemonShutdown();
      daemon?.closeAllConnections?.();
      await new Promise<void>((resolve) => daemon?.close(() => resolve()) ?? resolve());
      register.clear();
      vi.resetModules();

      const { startServer: startServer2 } = await import('../src/server.js');
      const restarted = (await startServer2({ port: 0, host: '127.0.0.1', returnServer: true })) as {
        url: string;
        server: http.Server;
        shutdown?: () => Promise<void> | void;
      };
      daemon = restarted.server;
      daemonShutdown = restarted.shutdown;
      baseUrl = restarted.url;

      const getResp2 = await fetch(`${baseUrl}/api/projects/${id}/cover`);
      expect(getResp2.status).toBe(200);
      const bytesAfter = Buffer.from(await getResp2.arrayBuffer());
      expect(bytesAfter.equals(bytesBefore)).toBe(true);
    },
    90_000,
  );

  it('GET returns 404 before any cover has been generated', async () => {
    const id = `cover-missing-${Date.now()}`;
    await createProject(id);
    const resp = await fetch(`${baseUrl}/api/projects/${id}/cover`);
    expect(resp.status).toBe(404);
  });

  it('POST for an unknown project returns a typed 404 failure envelope', async () => {
    const resp = await fetch(`${baseUrl}/api/projects/does-not-exist-${Date.now()}/cover/generate`, { method: 'POST' });
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as { ok: boolean; error?: { code?: string } };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('PROJECT_NOT_FOUND');
  });

  // Security review finding: GET .../cover joined req.params.id straight
  // onto the covers root with no isSafeId()/getProject() check (unlike the
  // POST generate handler, which validates via resolveProjectDir), so a
  // traversal-shaped id could read cover.png from a sibling RUNTIME_DATA_DIR
  // path. Seed a REAL cover under a sibling id-shaped directory the covers
  // root would sit next to, then prove a ".." id cannot reach it.
  it('GET rejects a path-traversal-shaped project id instead of escaping the covers root', async () => {
    const id = `cover-traversal-victim-${Date.now()}`;
    await createProject(id);
    await uploadFile(id, 'index.html', '<!doctype html><html><body>victim</body></html>');
    const gen = await fetch(`${baseUrl}/api/projects/${id}/cover/generate`, { method: 'POST' });
    expect(gen.status).toBe(200);

    // ".." resolves (via path.join(coversRoot, "..")) to RUNTIME_DATA_DIR
    // itself -- the traversal target a correct guard must reject.
    const traversalIds = ['..', '../..', `..%2F..%2Fcovers%2F${id}`];
    for (const traversalId of traversalIds) {
      const resp = await fetch(`${baseUrl}/api/projects/${traversalId}/cover`);
      expect(resp.status).toBe(404);
    }
  });

  // NOTE on edit mechanism: apps/daemon/src/server.ts's upload endpoint
  // (`uniqueUploadFileName`, ~line 1905) never overwrites an existing
  // same-named file -- a second upload of "styles.css" silently lands as
  // "styles-1.css" instead, which nothing in the entry HTML references. A
  // correct invalidation implementation cannot (and must not) regenerate
  // for an "edit" that never actually reached a referenced file, so these
  // tests edit via direct filesystem writes to the real on-disk file --
  // exactly how the C4-4a/C4-4b legs of scripts/waves/verify-w4.ts's own
  // probeC43C44 prove this (only its C4-3 legs and C4-4c go through the
  // same upload-based re-seed and are affected by this platform behavior;
  // see the final report for the full analysis).
  it(
    'invalidation is transitive and content-driven: a CSS-only edit (direct write) regenerates; an mtime-only touch does not (C4-3/C4-4)',
    async () => {
      const id = `cover-invalidate-${Date.now()}`;
      await createProject(id);
      await uploadFile(id, 'index.html', '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><div class="hero">v1</div></body></html>');
      await uploadFile(id, 'styles.css', '.hero{background:#101010;width:100%;height:300px}', 'text/css');

      const gen1 = (await (await fetch(`${baseUrl}/api/projects/${id}/cover/generate`, { method: 'POST' })).json()) as GenerateSuccess;

      // CSS-only edit (index.html untouched) must regenerate.
      const cssAbs = findOnDisk(dataDir, id, 'styles.css');
      expect(cssAbs).not.toBeNull();
      if (cssAbs) await writeFile(cssAbs, '.hero{background:#e00000;width:100%;height:300px}');
      const gen2 = (await (await fetch(`${baseUrl}/api/projects/${id}/cover/generate`, { method: 'POST' })).json()) as GenerateSuccess;
      expect(gen2.cover.sourceHash).not.toBe(gen1.cover.sourceHash);

      // mtime-only touch (bytes unchanged) must NOT regenerate --
      // sourceHash and generatedAt both stay identical (C4-4a).
      const indexAbs = findOnDisk(dataDir, id, 'index.html');
      expect(indexAbs).not.toBeNull();
      if (indexAbs) {
        const future = new Date(Date.now() + 60_000);
        await utimes(indexAbs, future, future);
      }
      const gen3 = (await (await fetch(`${baseUrl}/api/projects/${id}/cover/generate`, { method: 'POST' })).json()) as GenerateSuccess;
      expect(gen3.cover.sourceHash).toBe(gen2.cover.sourceHash);
      expect(gen3.cover.generatedAt).toBe(gen2.cover.generatedAt);

      // Byte change WITH mtime PINNED to its old value must still
      // regenerate -- proves invalidation is content-driven, not
      // mtime-driven, from the direction mtime actively lies (C4-4b).
      if (indexAbs) {
        const statBefore = await stat(indexAbs);
        await writeFile(indexAbs, '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><div class="hero">v2-mtime-pinned</div></body></html>');
        await utimes(indexAbs, statBefore.atime, statBefore.mtime);
      }
      const gen4 = (await (await fetch(`${baseUrl}/api/projects/${id}/cover/generate`, { method: 'POST' })).json()) as GenerateSuccess;
      expect(gen4.cover.sourceHash).not.toBe(gen3.cover.sourceHash);
    },
    45_000,
  );
});

function findOnDisk(root: string, projectId: string, fileName: string): string | null {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === fileName && full.includes(projectId)) return full;
    }
  }
  return null;
}
