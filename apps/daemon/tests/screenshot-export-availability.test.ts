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
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
});
