// W2G.6 / T-09 follow-up — a cover the project ADVERTISES must never answer
// 404.
//
// W2.6 published `Project.hasCover` so a client stops discovering the answer
// by taking a 404. That removed the ordinary pre-render request storm, but it
// left the race the bar actually counts:
//
//   1. `hasCoverImage` (apps/daemon/src/covers/store.ts) answers the projects
//      list with `fs.access(cover.png)` -- an existence check at list time.
//   2. `GET /api/projects/:id/cover` (apps/daemon/src/routes/covers.ts) reads
//      the bytes later, in a separate request.
//
// Between those two moments the file can be deleted (the user removes the
// cover from another tab), truncated mid-replace, or become unreadable. The
// client was told `hasCover: true`, has already put the URL in an `<img>`, and
// gets a 404 -- one `client_resource_error` -> `resource-failed` anomaly row
// for a resource the daemon itself advertised.
//
// Real booted daemon, real HTTP, real Chromium render, real filesystem damage
// -- same shape as covers-routes.test.ts. `readCoverImageBytes` is NOT stubbed:
// a mocked oracle here would prove nothing about the on-disk race.

import http from 'node:http';
import { mkdtemp, readFile, rm, stat, truncate, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The wire name of the header that tells a caller the bytes it just received
// are the placeholder rather than the stored cover. Pinned as a literal on
// purpose: this test owns the wire format, and
// `PROJECT_COVER_PLACEHOLDER_HEADER` in packages/contracts/src/api/covers.ts
// must keep matching it.
const PLACEHOLDER_HEADER = 'x-cover-placeholder';

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-cover-advertised-'));
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
}, 60_000); // vi.resetModules() forces a full re-transform of server.ts's module graph per test

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
}, 30_000);

async function createProject(id: string): Promise<void> {
  const resp = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name: id }),
  });
  expect(resp.ok).toBe(true);
}

async function uploadIndexHtml(projectId: string): Promise<void> {
  const form = new FormData();
  form.append(
    'files',
    new Blob(['<!doctype html><html><body style="background:#4477ff;height:400px"></body></html>'], {
      type: 'text/html',
    }),
    'index.html',
  );
  const resp = await fetch(`${baseUrl}/api/projects/${projectId}/upload`, { method: 'POST', body: form });
  expect(resp.ok).toBe(true);
}

/** The advertisement itself: what the projects list tells a client. */
async function listedHasCover(id: string): Promise<unknown> {
  const resp = await fetch(`${baseUrl}/api/projects`);
  expect(resp.status).toBe(200);
  const body = (await resp.json()) as { projects: Array<Record<string, unknown>> };
  const row = body.projects.find((project) => project.id === id);
  expect(row, `project ${id} must appear in GET /api/projects`).toBeTruthy();
  return (row as Record<string, unknown>).hasCover;
}

/**
 * Renders a real cover through the frozen POST route and returns the on-disk
 * path of the bytes it stored, derived from the daemon data directory
 * contract (RUNTIME_DATA_DIR/covers/<projectId>/cover.png) rather than by
 * importing daemon source.
 */
async function generateCover(id: string): Promise<string> {
  const genResp = await fetch(`${baseUrl}/api/projects/${id}/cover/generate`, { method: 'POST' });
  expect(genResp.status).toBe(200);
  const imagePath = path.join(dataDir, 'covers', id, 'cover.png');
  expect((await stat(imagePath)).isFile()).toBe(true);
  return imagePath;
}

describe('W2G.6 — a cover the project advertises never answers 404', () => {
  it(
    'answers a valid placeholder image, not 404, when the advertised bytes are deleted after the availability check',
    async () => {
      const id = `cover-deleted-${Date.now()}`;
      await createProject(id);
      await uploadIndexHtml(id);
      const imagePath = await generateCover(id);

      // The advertisement the client acts on. After this line the client has
      // already put the cover URL in an <img>.
      expect(await listedHasCover(id)).toBe(true);

      // ...and the file goes away before the <img> request lands.
      await unlink(imagePath);

      const resp = await fetch(`${baseUrl}/api/projects/${id}/cover`);
      expect(resp.status).toBe(200);
      expect(resp.headers.get('content-type')).toBe('image/png');
      expect(resp.headers.get(PLACEHOLDER_HEADER)).toBe('1');
      const bytes = Buffer.from(await resp.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(0);
      // A real PNG signature -- a placeholder an <img> cannot decode would
      // fire the same client_resource_error the 404 fired.
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    },
    180_000,
  );

  it(
    'answers a valid placeholder image, not empty bytes, when the advertised cover is truncated mid-replace',
    async () => {
      const id = `cover-truncated-${Date.now()}`;
      await createProject(id);
      await uploadIndexHtml(id);
      const imagePath = await generateCover(id);

      expect(await listedHasCover(id)).toBe(true);

      // A zero-length cover.png reads back as an empty Buffer, which is
      // truthy -- so the route serves 200 with no body and the <img> fails
      // exactly as it does on a 404.
      await truncate(imagePath, 0);

      const resp = await fetch(`${baseUrl}/api/projects/${id}/cover`);
      expect(resp.status).toBe(200);
      const bytes = Buffer.from(await resp.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(0);
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(resp.headers.get(PLACEHOLDER_HEADER)).toBe('1');
    },
    180_000,
  );

  // Round-1 audit hardening (GLM finding 2): "the read returned something" is
  // the wrong line. A write cut short after the PNG header is non-empty, so it
  // passed a length-only check and was served 200 image/png -- and an <img>
  // cannot decode it, so it fires the same client_resource_error the 404
  // fires. The bytes here keep a valid PNG signature and lose the IEND chunk.
  it(
    'answers a valid placeholder image when the advertised cover is cut short after its header',
    async () => {
      const id = `cover-cutshort-${Date.now()}`;
      await createProject(id);
      await uploadIndexHtml(id);
      const imagePath = await generateCover(id);

      expect(await listedHasCover(id)).toBe(true);

      await truncate(imagePath, 64);
      const damaged = await readFile(imagePath);
      expect(damaged.length).toBe(64);
      expect(damaged.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

      const resp = await fetch(`${baseUrl}/api/projects/${id}/cover`);
      expect(resp.status).toBe(200);
      const bytes = Buffer.from(await resp.arrayBuffer());
      expect(bytes.length).not.toBe(64);
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(bytes.subarray(bytes.length - 8, bytes.length - 4).toString('ascii')).toBe('IEND');
      expect(resp.headers.get(PLACEHOLDER_HEADER)).toBe('1');
    },
    180_000,
  );

  it('still answers 404, with no placeholder header, for a project that has never advertised a cover', async () => {
    const id = `cover-never-${Date.now()}`;
    await createProject(id);
    await uploadIndexHtml(id);

    expect(await listedHasCover(id)).toBe(false);

    const resp = await fetch(`${baseUrl}/api/projects/${id}/cover`);
    expect(resp.status).toBe(404);
    expect(resp.headers.get(PLACEHOLDER_HEADER)).toBeNull();
  });

  it('still answers 404 for an unknown project', async () => {
    const resp = await fetch(`${baseUrl}/api/projects/does-not-exist-${Date.now()}/cover`);
    expect(resp.status).toBe(404);
  });

  // The placeholder must not soften the path-traversal guard: it is a defence,
  // not an answer about cover availability. Raw sockets because fetch/URL
  // normalizes dot segments on the CLIENT (see covers-routes.test.ts).
  it('still answers 404 for a path-traversal-shaped project id, never a placeholder', async () => {
    const rawResponse = (rawPath: string) =>
      new Promise<{ status: number; placeholder: string | undefined }>((resolve, reject) => {
        const req = http.request(new URL(baseUrl), { path: rawPath, method: 'GET' }, (res) => {
          res.resume();
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              placeholder: res.headers[PLACEHOLDER_HEADER] as string | undefined,
            }),
          );
        });
        req.on('error', reject);
        req.end();
      });

    for (const traversalId of ['..', '../..', '..%2F..%2Fcovers%2Fsomething']) {
      const result = await rawResponse(`/api/projects/${traversalId}/cover`);
      expect(result.status).toBe(404);
      expect(result.placeholder).toBeUndefined();
    }
  });
});
