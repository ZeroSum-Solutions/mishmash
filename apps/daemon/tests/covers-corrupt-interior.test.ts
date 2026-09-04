// W2H.5 / T-09..T-10 -- a stored cover with a valid frame but corrupt interior
// bytes is never served as `image/png`.
//
// W2G.6 made `GET /api/projects/:id/cover` answer either the stored cover or
// the placeholder, and drew the line with a FRAME check
// (`isCompleteCoverImage`, apps/daemon/src/routes/covers.ts): the 8-byte
// signature, a minimum length, and `IEND` in `bytes[-8..-4]`. Damage can keep
// both of those edges. A byte flipped inside an IDAT chunk, an IHDR whose
// declared length is not 13, a truncated IDAT payload -- each leaves the
// signature and the trailing `IEND` exactly where the predicate looks, so the
// bytes are answered `200 image/png`, and no PNG decoder can read them.
//
// That is the row W2G.6's own docblock promises is impossible: "An `<img>`
// fires the same `client_resource_error` -> `resource-failed` anomaly for
// bytes it cannot decode as it does for a 404."
//
// Real booted daemon, real HTTP, real Chromium render, real byte-level damage
// to the file the store wrote. The damage is PROVED undecodable by running it
// through `sharp` -- the same image engine `apps/daemon/src/covers/crop.ts`
// produced the cover with -- rather than asserted from the shape of the edit.

import http from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The wire name of the header that marks the served bytes as the placeholder
// rather than the stored cover. Pinned as a literal for the same reason
// covers-advertised-never-404.test.ts pins it: this test owns the wire format,
// and `PROJECT_COVER_PLACEHOLDER_HEADER` in packages/contracts must keep
// matching it.
const PLACEHOLDER_HEADER = 'x-cover-placeholder';
const PNG_SIGNATURE_HEX = '89504e470d0a1a0a';

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-cover-corrupt-'));
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

/**
 * Renders a real cover through the frozen POST route and returns the on-disk
 * path of the bytes it stored, derived from the daemon data directory contract
 * (RUNTIME_DATA_DIR/covers/<projectId>/cover.png) rather than by importing
 * daemon source.
 */
async function generateCover(id: string): Promise<string> {
  const genResp = await fetch(`${baseUrl}/api/projects/${id}/cover/generate`, { method: 'POST' });
  expect(genResp.status).toBe(200);
  const imagePath = path.join(dataDir, 'covers', id, 'cover.png');
  expect((await stat(imagePath)).isFile()).toBe(true);
  return imagePath;
}

interface PngChunk {
  offset: number;
  length: number;
  type: string;
}

/**
 * The chunk table of `bytes`, read the way any PNG reader reads it: from byte
 * 8, each chunk a 4-byte big-endian length, a 4-byte type, that many data
 * bytes, and a 4-byte CRC. Test-local on purpose -- the point of this file is
 * to damage the interior a route predicate is not looking at, so it must find
 * the chunks itself rather than borrow the daemon helper under test.
 */
function pngChunks(bytes: Buffer): PngChunk[] {
  const chunks: PngChunk[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    chunks.push({ offset, length, type: bytes.subarray(offset + 4, offset + 8).toString('ascii') });
    offset += 12 + length;
  }
  return chunks;
}

/** Whether a real PNG decoder can turn `bytes` into pixels, as an `<img>` must. */
async function decodesToPixels(bytes: Buffer): Promise<boolean> {
  try {
    await sharp(bytes).raw().toBuffer();
    return true;
  } catch {
    return false;
  }
}

/** Inverts the byte at `offset`, in place. */
function flipByte(bytes: Buffer, offset: number): void {
  bytes.writeUInt8(bytes.readUInt8(offset) ^ 0xff, offset);
}

/** A cover whose frame survives the damage: the predicate's two edges intact. */
function hasIntactFrame(bytes: Buffer): boolean {
  return (
    bytes.subarray(0, 8).toString('hex') === PNG_SIGNATURE_HEX &&
    bytes.subarray(bytes.length - 8, bytes.length - 4).toString('ascii') === 'IEND'
  );
}

/** How one damage shape rewrites a rendered cover's bytes. */
type Damage = (original: Buffer, chunkOf: (type: string) => PngChunk) => Buffer;

/**
 * Renders a real cover for its own project, replaces the stored bytes with
 * `damage(original)`, and requires the route to answer something decodable.
 *
 * One project and one render per damage shape, driven from a separate `it`, so
 * no shape can hide behind an earlier one: a loop over the three would abort at
 * the first failing assertion and leave the other two unproven on base.
 */
async function expectDamagedCoverIsNotServed(idPrefix: string, damage: Damage): Promise<void> {
  const id = `${idPrefix}-${Date.now()}`;
  await createProject(id);
  await uploadIndexHtml(id);
  const imagePath = await generateCover(id);

  const original = await readFile(imagePath);
  expect(await decodesToPixels(original), 'the rendered cover must decode before it is damaged').toBe(true);

  const chunks = pngChunks(original);
  const chunkOf = (type: string): PngChunk => {
    const chunk = chunks.find((candidate) => candidate.type === type);
    expect(chunk, `a rendered cover must carry a ${type} chunk`).toBeTruthy();
    return chunk as PngChunk;
  };

  const damaged = damage(original, chunkOf);
  expect(hasIntactFrame(damaged), 'the PNG frame must survive the damage').toBe(true);
  expect(await decodesToPixels(damaged), 'the damaged bytes must not decode').toBe(false);

  await writeFile(imagePath, damaged);

  const resp = await fetch(`${baseUrl}/api/projects/${id}/cover`);
  expect(resp.status, 'an advertised cover still answers 200').toBe(200);
  expect(resp.headers.get('content-type')).toBe('image/png');

  const served = Buffer.from(await resp.arrayBuffer());
  // The bar: what the route answered decodes. Serving the damaged bytes is
  // exactly the `resource-failed` row W2G.6 promised was impossible.
  expect(await decodesToPixels(served), 'the bytes GET /api/projects/:id/cover answered must decode').toBe(true);
  expect(served.equals(damaged), 'the damaged bytes must not be served').toBe(false);
  expect(resp.headers.get(PLACEHOLDER_HEADER), 'the answer is flagged as the placeholder').toBe('1');
}

describe('W2H.5 — a cover with a valid frame but corrupt interior is never served as image/png', () => {
  it(
    'serves the placeholder when a byte inside the IDAT payload is flipped',
    async () => {
      await expectDamagedCoverIsNotServed('cover-idat-byte', (original, chunkOf) => {
        const damaged = Buffer.from(original);
        flipByte(damaged, chunkOf('IDAT').offset + 8 + 3);
        return damaged;
      });
    },
    240_000,
  );

  it(
    'serves the placeholder when the IHDR chunk declares a length other than 13',
    async () => {
      await expectDamagedCoverIsNotServed('cover-ihdr-length', (original, chunkOf) => {
        const damaged = Buffer.from(original);
        damaged.writeUInt32BE(12, chunkOf('IHDR').offset);
        return damaged;
      });
    },
    240_000,
  );

  it(
    'serves the placeholder when the IDAT payload is truncated in place',
    async () => {
      await expectDamagedCoverIsNotServed('cover-idat-truncated', (original, chunkOf) => {
        const idat = chunkOf('IDAT');
        const kept = Math.floor(idat.length / 2);
        const header = Buffer.alloc(8);
        header.writeUInt32BE(kept, 0);
        header.write('IDAT', 4, 'ascii');
        return Buffer.concat([
          original.subarray(0, idat.offset),
          header,
          original.subarray(idat.offset + 8, idat.offset + 8 + kept),
          // The original CRC, kept over a payload that is now shorter.
          original.subarray(idat.offset + 8 + idat.length, idat.offset + 12 + idat.length),
          original.subarray(idat.offset + 12 + idat.length),
        ]);
      });
    },
    240_000,
  );
});
