// W2.6 / T-10 — `isImageScreenshotExportAvailable` must answer the same
// question the export route answers.
//
// The agent charter names `od export ... --format image` only when this
// predicate holds (apps/daemon/src/prompts/core-slim.ts). That is only safe
// while the predicate and `handleScreenshotExport` agree, so this pins the
// pair against a real booted daemon: a plain boot wires no desktop renderer,
// the predicate reports false, and the route answers 501 with the shared
// message.

import http from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExportCapabilitiesResponse } from '@open-design/contracts';
import {
  SCREENSHOT_EXPORT_UNAVAILABLE_MESSAGE,
  isImageScreenshotExportAvailable,
} from '../src/screenshot-export-availability.js';

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-export-availability-'));
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
}, 60_000);

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

describe('isImageScreenshotExportAvailable', () => {
  it('is false with no renderer, true with either one', () => {
    expect(isImageScreenshotExportAvailable(undefined)).toBe(false);
    expect(isImageScreenshotExportAvailable({})).toBe(false);
    expect(
      isImageScreenshotExportAvailable({
        desktopSlideRenderer: null,
        desktopArtifactExporter: null,
      }),
    ).toBe(false);
    expect(isImageScreenshotExportAvailable({ desktopSlideRenderer: () => {} })).toBe(true);
    expect(isImageScreenshotExportAvailable({ desktopArtifactExporter: () => {} })).toBe(true);
  });

  it('agrees with the export route on a plain daemon boot', async () => {
    const id = `export-501-${Date.now()}`;
    const created = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: id }),
    });
    expect(created.ok).toBe(true);

    // A plain boot passes no renderers (apps/daemon/src/server.ts defaults
    // them to null), which is what the predicate reports on.
    expect(isImageScreenshotExportAvailable({})).toBe(false);

    const resp = await fetch(`${baseUrl}/api/projects/${id}/export/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'index.html' }),
    });
    expect(resp.status).toBe(501);
    const body = (await resp.json()) as { error?: { message?: string } };
    expect(body.error?.message).toBe(SCREENSHOT_EXPORT_UNAVAILABLE_MESSAGE);
  }, 60_000);

  // The other direction: the predicate claims an artifact exporter ALONE is
  // enough for `format === 'image'` (handleScreenshotExport's fallback branch).
  // A daemon booted with only that renderer must therefore NOT 501 — otherwise
  // the charter would name the command in a runtime that still refuses it.
  // The slide-renderer direction is already covered end to end by
  // screenshot-export-file-handoff.test.ts, which boots with a stub
  // `desktopSlideRenderer` and gets 200 image bytes back.
  it('does not 501 when only the artifact exporter is wired, which the predicate calls available', async () => {
    const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
    const exporterDir = await mkdtemp(path.join(os.tmpdir(), 'od-export-artifact-'));
    const renderers = {
      desktopArtifactExporter: async () => {
        const file = path.join(exporterDir, 'artifact.png');
        await writeFile(file, PNG);
        return { ok: true, path: file, mime: 'image/png' };
      },
    };
    expect(isImageScreenshotExportAvailable(renderers)).toBe(true);

    const { startServer } = await import('../src/server.js');
    const started = (await startServer({
      port: 0,
      host: '127.0.0.1',
      returnServer: true,
      ...renderers,
    })) as { url: string; server: http.Server; shutdown?: () => Promise<void> | void };

    try {
      const id = `export-artifact-${Date.now()}`;
      const created = await fetch(`${started.url}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: id }),
      });
      expect(created.ok).toBe(true);
      const projectDir = path.join(process.env.OD_DATA_DIR!, 'projects', id);
      await mkdir(projectDir, { recursive: true });
      await writeFile(path.join(projectDir, 'index.html'), '<html><body>hi</body></html>');

      const resp = await fetch(`${started.url}/api/projects/${id}/export/image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: 'index.html' }),
      });
      expect(resp.status).not.toBe(501);
      expect(resp.status).toBe(200);
      expect(resp.headers.get('content-type')).toContain('image/png');
    } finally {
      await Promise.race([
        Promise.resolve(started.shutdown?.()),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
      started.server.closeAllConnections?.();
      await new Promise<void>((resolve) => started.server.close(() => resolve()));
      await rm(exporterDir, { recursive: true, force: true }).catch(() => {});
    }
  }, 60_000);
});

// W2K.1 red spec (daemon half) -- the predicate answers the same question for a
// CLIENT, over HTTP.
//
// Knowing the answer only inside the daemon is what let the web Studio probe
// `POST /api/projects/:id/export/image` on every "Export as image" click in a
// runtime that cannot serve it: the route 501s, the client falls through to its
// visible-preview capture, and the user gets an image -- but the 501 is recorded
// on both anomaly sources every single time (FU-33). A client that has its own
// fallback must be able to ask first.
//
// RED on `ea2eee96d`: the route does not exist, so the plain-boot case gets a
// 404 instead of `{ image: false }`.
describe('GET /api/export/capabilities', () => {
  it('reports image:false on a plain daemon boot, matching the 501 the export route answers', async () => {
    const resp = await fetch(`${baseUrl}/api/export/capabilities`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as ExportCapabilitiesResponse;
    expect(body.image).toBe(false);
    // Same daemon, same boot: what the capability claims is what the export
    // route does. A capability that disagreed with the route would send the
    // client back to probing (or, worse, stop it probing a daemon that works).
    expect(isImageScreenshotExportAvailable({})).toBe(body.image);
  }, 60_000);

  it('reports image:true when a renderer is wired', async () => {
    const renderers = { desktopSlideRenderer: async () => ({ ok: false, error: 'not called' }) };
    expect(isImageScreenshotExportAvailable(renderers)).toBe(true);

    const { startServer } = await import('../src/server.js');
    const started = (await startServer({
      port: 0,
      host: '127.0.0.1',
      returnServer: true,
      ...renderers,
    })) as { url: string; server: http.Server; shutdown?: () => Promise<void> | void };

    try {
      const resp = await fetch(`${started.url}/api/export/capabilities`);
      expect(resp.status).toBe(200);
      const body = (await resp.json()) as ExportCapabilitiesResponse;
      expect(body.image).toBe(true);
    } finally {
      await Promise.race([
        Promise.resolve(started.shutdown?.()),
        new Promise((r) => setTimeout(r, 2000)),
      ]);
      started.server.closeAllConnections?.();
      await new Promise<void>((resolve) => started.server.close(() => resolve()));
    }
  }, 60_000);
});
