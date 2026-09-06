// W2K.3 red spec (daemon half) -- `GET /api/export/capabilities` must answer for
// each renderer-backed export format separately.
//
// 2K.1 (#222) added the route with ONE flag, `image`. That flag is computed from
// the slide renderer OR the artifact exporter, so it cannot speak for the other
// three export formats this daemon serves, which need different wiring:
//
//   POST /export/pdf        -> `desktopPdfExporter`   (native/vector PDF)
//   POST /export/pdf-image  -> `desktopSlideRenderer` (raster PDF)
//   POST /export/pptx       -> `desktopSlideRenderer`
//   POST /export/image      -> slide renderer OR artifact exporter
//
// A client told only `image: false` still has to guess about pptx and raster
// PDF, which is the guess that keeps producing 501 rows (FU-34, D-23).
//
// Each case below boots a real daemon with a known renderer set and reads the
// route over HTTP, then confirms the claim against the export route it
// describes, so a capability that lied about a format would fail here.
//
// RED on `d3b9bd38b`: the response carries only `image`, so `nativePdf`,
// `rasterPdf` and `pptx` are `undefined` instead of booleans.

import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExportCapabilitiesResponse } from '@open-design/contracts';

type StartedDaemon = {
  url: string;
  server: http.Server;
  shutdown?: () => Promise<void> | void;
};

let dataDir = '';
const started: StartedDaemon[] = [];
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

/** A renderer closure whose only job is to exist: capabilities never invoke it. */
const stubRenderer = async () => ({ ok: false, error: 'not called' });

async function bootDaemon(renderers: Record<string, unknown>): Promise<StartedDaemon> {
  const { startServer } = await import('../src/server.js');
  const daemon = (await startServer({
    port: 0,
    host: '127.0.0.1',
    returnServer: true,
    ...renderers,
  })) as StartedDaemon;
  started.push(daemon);
  return daemon;
}

async function readCapabilities(daemon: StartedDaemon): Promise<ExportCapabilitiesResponse> {
  const resp = await fetch(`${daemon.url}/api/export/capabilities`);
  expect(resp.status).toBe(200);
  return (await resp.json()) as ExportCapabilitiesResponse;
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-export-capabilities-'));
  process.env.OD_DATA_DIR = dataDir;
});

afterEach(async () => {
  while (started.length > 0) {
    const daemon = started.pop()!;
    await Promise.race([
      Promise.resolve(daemon.shutdown?.()),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
    daemon.server.closeAllConnections?.();
    await new Promise<void>((resolve) => daemon.server.close(() => resolve()));
  }
  if (PREV_DATA_DIR === undefined) delete process.env.OD_DATA_DIR;
  else process.env.OD_DATA_DIR = PREV_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  register.clear();
  vi.resetModules();
}, 30_000);

describe('GET /api/export/capabilities reports each renderer-backed format', () => {
  it('reports every format false on a renderer-less boot', async () => {
    const daemon = await bootDaemon({});
    const body = await readCapabilities(daemon);

    expect(body).toEqual({ nativePdf: false, rasterPdf: false, pptx: false, image: false });

    // The claim, checked against the routes it describes: a plain boot 501s the
    // native PDF route too, which the single `image` flag never said.
    const id = `caps-none-${Date.now()}`;
    const created = await fetch(`${daemon.url}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: id }),
    });
    expect(created.ok).toBe(true);
    const pdf = await fetch(`${daemon.url}/api/projects/${id}/export/pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'index.html' }),
    });
    expect(pdf.status).toBe(501);
  }, 60_000);

  it('reports nativePdf alone when only the PDF exporter is wired', async () => {
    // `desktopPdfExporter` serves POST /export/pdf and nothing else: the raster
    // PDF, pptx and image routes all rasterize through the OTHER renderers.
    const daemon = await bootDaemon({ desktopPdfExporter: stubRenderer });
    const body = await readCapabilities(daemon);

    expect(body).toEqual({ nativePdf: true, rasterPdf: false, pptx: false, image: false });
  }, 60_000);

  it('reports rasterPdf, pptx and image when only the slide renderer is wired', async () => {
    // `desktopSlideRenderer` is what `handleScreenshotExport` calls for all three
    // screenshot formats; the native PDF route still has no exporter.
    const daemon = await bootDaemon({ desktopSlideRenderer: stubRenderer });
    const body = await readCapabilities(daemon);

    expect(body).toEqual({ nativePdf: false, rasterPdf: true, pptx: true, image: true });
  }, 60_000);

  it('reports image alone when only the artifact exporter is wired', async () => {
    // The artifact exporter is `handleScreenshotExport`'s fallback for
    // `format === 'image'` ONLY, so it must not claim pptx or the raster PDF.
    const daemon = await bootDaemon({ desktopArtifactExporter: stubRenderer });
    const body = await readCapabilities(daemon);

    expect(body).toEqual({ nativePdf: false, rasterPdf: false, pptx: false, image: true });
  }, 60_000);

  it('reports every format true when the sidecar wires all three renderers', async () => {
    // The shape `apps/daemon/src/sidecar/server.ts` boots -- i.e. what a
    // tools-dev runtime answers.
    const daemon = await bootDaemon({
      desktopPdfExporter: stubRenderer,
      desktopSlideRenderer: stubRenderer,
      desktopArtifactExporter: stubRenderer,
    });
    const body = await readCapabilities(daemon);

    expect(body).toEqual({ nativePdf: true, rasterPdf: true, pptx: true, image: true });
  }, 60_000);
});
