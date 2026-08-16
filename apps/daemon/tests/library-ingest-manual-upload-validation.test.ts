// POST /api/library/ingest — manual-upload validation (kit-upload:
// logo / font / image). The existing library-ingest-* test files cover the
// extension-token clipper path (SSRF, byte-volume cap, dedup race) and rate
// limiting, but none of them exercise the MANUAL-UPLOAD branch's own guards:
// `LIBRARY_UPLOAD_MAX_BYTES` (413) and `isLibraryUploadMimeAllowed` (415).
// A manual upload is what the web UI's Library / design-kit uploader uses
// for logos, fonts, and images dropped straight from the local same-origin
// UI (no extension token) — see routes/library.ts's `sourceKind` branch.
//
// Real transport throughout: a real booted daemon, real HTTP requests, no
// mocked fetch/db, matching the sibling library-ingest-*.test.ts files.

import type http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIBRARY_UPLOAD_MAX_BYTES } from '@open-design/contracts';

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-library-manual-upload-'));
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
});

// No Origin header + Host matching the loopback bind host is the daemon's
// definition of a "local same-origin" caller (isLocalSameOrigin) — the same
// shape the web UI's own same-origin fetch takes, and distinct from the
// extension-token 'clipper' path exercised in the sibling test files.
async function manualIngest(body: unknown) {
  return fetch(`${baseUrl}/api/library/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function pngDataUrl(bytes: Buffer): string {
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

describe('POST /api/library/ingest — manual upload (kit: logo/font/image)', () => {
  it('accepts a PNG image under the size cap', async () => {
    const res = await manualIngest({
      dataUrl: pngDataUrl(Buffer.alloc(1_000, 1)),
      filename: 'logo.png',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { asset?: { kind?: string } };
    expect(body.asset?.kind).toBe('image');
  });

  it('accepts a font upload identified by an explicit font MIME type', async () => {
    const res = await manualIngest({
      dataUrl: `data:font/woff2;base64,${Buffer.alloc(500, 2).toString('base64')}`,
      filename: 'brand.woff2',
    });
    expect(res.status).toBe(200);
  });

  it('accepts a font upload identified by its extension when the MIME is generic octet-stream', async () => {
    const res = await manualIngest({
      dataUrl: `data:application/octet-stream;base64,${Buffer.alloc(500, 3).toString('base64')}`,
      filename: 'brand.woff2',
    });
    expect(res.status).toBe(200);
  });

  it('413s a manual-upload image that exceeds LIBRARY_UPLOAD_MAX_BYTES', async () => {
    const oversize = Buffer.alloc(LIBRARY_UPLOAD_MAX_BYTES + 1024, 4);
    const res = await manualIngest({ dataUrl: pngDataUrl(oversize), filename: 'huge-logo.png' });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(message).toMatch(/too large/i);
  });

  it('accepts a manual-upload image of exactly LIBRARY_UPLOAD_MAX_BYTES (boundary)', async () => {
    const exact = Buffer.alloc(LIBRARY_UPLOAD_MAX_BYTES, 5);
    const res = await manualIngest({ dataUrl: pngDataUrl(exact), filename: 'exact-logo.png' });
    expect(res.status).toBe(200);
  });

  it('415s a manual-upload video (design-relevant formats only)', async () => {
    const res = await manualIngest({
      dataUrl: `data:video/mp4;base64,${Buffer.alloc(200, 6).toString('base64')}`,
      filename: 'clip.mp4',
    });
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(message).toMatch(/cannot be uploaded to the Library/i);
  });

  it('415s a manual-upload audio file', async () => {
    const res = await manualIngest({
      dataUrl: `data:audio/mpeg;base64,${Buffer.alloc(200, 7).toString('base64')}`,
      filename: 'jingle.mp3',
    });
    expect(res.status).toBe(415);
  });

  it('415s an unrecognized binary with no usable MIME or extension', async () => {
    const res = await manualIngest({
      dataUrl: `data:application/octet-stream;base64,${Buffer.alloc(200, 8).toString('base64')}`,
      filename: 'payload.exe',
    });
    expect(res.status).toBe(415);
  });
});
