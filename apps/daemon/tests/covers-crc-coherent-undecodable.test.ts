// W2I.4 -- a stored cover whose chunks and CRCs are coherent but whose IDAT
// stream does not inflate to the image its header declares is never served as
// `image/png`.
//
// W2H.5 replaced the frame check with `isIntactPng`
// (apps/daemon/src/covers/png.ts), a full container walk that recomputes every
// chunk's CRC-32. Its own docblock names the gap that walk leaves: it does not
// inflate the compressed stream inside `IDAT`, so bytes whose payload was
// corrupted AND whose CRC was recomputed to match pass the check and are still
// answered `200 image/png` by `routes/covers.ts`. No PNG decoder can read them.
//
// Two damage shapes reach exactly that gap, and neither needs an unusual
// writer -- both are what a container-only check cannot see:
//
//   1. A byte flipped inside the IDAT compressed payload with the chunk CRC
//      recomputed. The container is coherent; the deflate stream is not.
//   2. An IDAT carrying a VALID, complete zlib stream that inflates to fewer
//      bytes than `IHDR` declares. Nothing about the container is wrong; the
//      image is simply not all there.
//
// W2J.2 adds a third shape the pixel-stream length check cannot see at all:
// an IHDR that lies about the layout its own stream is in. An interlace byte
// flipped to 1, or a colour type paired with a bit depth the format does not
// define, leaves a container whose CRCs all agree and a stream that inflates,
// while no decoder can read a pixel of it.
//
// Real booted daemon, real HTTP, real Chromium render. The damage is PROVED
// undecodable by running it through `sharp` -- the engine
// apps/daemon/src/covers/crop.ts produced the cover with -- and PROVED
// CRC-coherent by recomputing every chunk CRC in the test, rather than
// asserted from the shape of the edit.

import http from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The wire name of the header that marks the served bytes as the placeholder
// rather than the stored cover. Pinned as a literal for the same reason
// covers-corrupt-interior.test.ts pins it: this test owns the wire format, and
// `PROJECT_COVER_PLACEHOLDER_HEADER` in packages/contracts must keep matching
// it.
const PLACEHOLDER_HEADER = 'x-cover-placeholder';

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-cover-idat-'));
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
 * bytes, and a 4-byte CRC. Test-local on purpose -- this file damages the
 * compressed stream a container check cannot see, so it must find the chunks
 * itself rather than borrow the daemon helper under test.
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

/**
 * Whether EVERY chunk's stored CRC-32 agrees with its type and data -- the
 * property `isIntactPng` checks and the reason these damaged covers pass it.
 * Asserting it here is what makes the case adversarial rather than incidental.
 */
function everyChunkCrcAgrees(bytes: Buffer): boolean {
  return pngChunks(bytes).every((chunk) => {
    const crcStart = chunk.offset + 8 + chunk.length;
    if (crcStart + 4 > bytes.length) return false;
    return crc32(bytes.subarray(chunk.offset + 4, crcStart)) === bytes.readUInt32BE(crcStart);
  });
}

/** Rewrites the chunk at `offset` so its stored CRC matches its contents. */
function withRepairedCrc(bytes: Buffer, chunk: PngChunk): Buffer {
  const repaired = Buffer.from(bytes);
  const crcStart = chunk.offset + 8 + chunk.length;
  repaired.writeUInt32BE(crc32(repaired.subarray(chunk.offset + 4, crcStart)), crcStart);
  return repaired;
}

/** The concatenated IDAT payloads -- the one compressed stream a PNG carries. */
function idatStream(bytes: Buffer, chunks: PngChunk[]): Buffer {
  return Buffer.concat(
    chunks
      .filter((chunk) => chunk.type === 'IDAT')
      .map((chunk) => bytes.subarray(chunk.offset + 8, chunk.offset + 8 + chunk.length)),
  );
}

/** Replaces every IDAT chunk with one carrying `payload`, CRC recomputed. */
function withIdatStream(bytes: Buffer, chunks: PngChunk[], payload: Buffer): Buffer {
  const idats = chunks.filter((chunk) => chunk.type === 'IDAT');
  const first = idats[0] as PngChunk;
  const last = idats[idats.length - 1] as PngChunk;
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length, 0);
  header.write('IDAT', 4, 'ascii');
  const rebuilt = Buffer.concat([
    bytes.subarray(0, first.offset),
    header,
    payload,
    Buffer.alloc(4),
    bytes.subarray(last.offset + 12 + last.length),
  ]);
  return withRepairedCrc(rebuilt, { offset: first.offset, length: payload.length, type: 'IDAT' });
}

/** How one damage shape rewrites a rendered cover's bytes. */
type Damage = (original: Buffer, chunks: PngChunk[]) => Buffer;

/**
 * Renders a real cover for its own project, replaces the stored bytes with
 * `damage(original)`, and requires the route to answer something decodable.
 *
 * One project and one render per damage shape, driven from a separate `it`, so
 * neither shape can hide behind the other.
 */
async function expectUndecodableCoverIsNotServed(idPrefix: string, damage: Damage): Promise<void> {
  const id = `${idPrefix}-${Date.now()}`;
  await createProject(id);
  await uploadIndexHtml(id);
  const imagePath = await generateCover(id);

  const original = await readFile(imagePath);
  expect(await decodesToPixels(original), 'the rendered cover must decode before it is damaged').toBe(true);

  const damaged = damage(original, pngChunks(original));
  expect(everyChunkCrcAgrees(damaged), 'every chunk CRC must still agree after the damage').toBe(true);
  expect(await decodesToPixels(damaged), 'the damaged bytes must not decode').toBe(false);

  await writeFile(imagePath, damaged);

  const resp = await fetch(`${baseUrl}/api/projects/${id}/cover`);
  expect(resp.status, 'an advertised cover still answers 200').toBe(200);
  expect(resp.headers.get('content-type')).toBe('image/png');

  const served = Buffer.from(await resp.arrayBuffer());
  // The bar: what the route answered decodes. Serving CRC-coherent bytes that
  // no decoder can read is the `resource-failed` row W2H.5 promised was
  // impossible.
  expect(await decodesToPixels(served), 'the bytes GET /api/projects/:id/cover answered must decode').toBe(true);
  expect(served.equals(damaged), 'the undecodable bytes must not be served').toBe(false);
  expect(resp.headers.get(PLACEHOLDER_HEADER), 'the answer is flagged as the placeholder').toBe('1');
}

describe('W2I.4 — a cover whose IDAT stream does not inflate to its declared image is never served as image/png', () => {
  it(
    'serves the placeholder when a byte inside the IDAT stream is flipped and the chunk CRC repaired',
    async () => {
      await expectUndecodableCoverIsNotServed('cover-idat-crc-repaired', (original, chunks) => {
        const idat = chunks.find((chunk) => chunk.type === 'IDAT') as PngChunk;
        const damaged = Buffer.from(original);
        // Byte 3 of the payload sits inside the deflate blocks, past the
        // 2-byte zlib header, so the stream itself is what breaks.
        const target = idat.offset + 8 + 3;
        damaged.writeUInt8(damaged.readUInt8(target) ^ 0xff, target);
        return withRepairedCrc(damaged, idat);
      });
    },
    240_000,
  );

  it(
    'serves the placeholder when the IDAT stream inflates to fewer bytes than IHDR declares',
    async () => {
      await expectUndecodableCoverIsNotServed('cover-idat-inflates-short', (original, chunks) => {
        const raw = inflateSync(idatStream(original, chunks));
        // A complete, valid zlib stream carrying half the scanlines: nothing
        // about the container is wrong, the image is simply not all there.
        const short = deflateSync(raw.subarray(0, Math.floor(raw.length / 2)));
        return withIdatStream(original, chunks, short);
      });
    },
    240_000,
  );
});

describe('W2J.2 — a cover whose IHDR lies about its layout is never served as image/png', () => {
  it(
    'serves the placeholder when IHDR claims Adam7 interlacing over single-pass rows',
    async () => {
      await expectUndecodableCoverIsNotServed('cover-ihdr-interlace-lie', (original, chunks) => {
        const ihdr = chunks.find((chunk) => chunk.type === 'IHDR') as PngChunk;
        const lied = Buffer.from(original);
        // IHDR byte 12 is the interlace method: 0 is the single pass the cover
        // renderer writes, 1 claims Adam7's seven reduced passes.
        lied.writeUInt8(1, ihdr.offset + 8 + 12);
        return withRepairedCrc(lied, ihdr);
      });
    },
    240_000,
  );

  it(
    'serves the placeholder when IHDR pairs colour type 3 with bit depth 16',
    async () => {
      await expectUndecodableCoverIsNotServed('cover-ihdr-illegal-pair', (original, chunks) => {
        const ihdr = chunks.find((chunk) => chunk.type === 'IHDR') as PngChunk;
        const width = original.readUInt32BE(ihdr.offset + 8);
        const height = original.readUInt32BE(ihdr.offset + 12);
        // The PNG format defines indexed colour at bit depths 1, 2, 4 and 8
        // only. The IDAT is rebuilt to exactly the byte count this illegal
        // pair predicts, so the pair itself -- not a length mismatch behind
        // it -- is what the route must catch.
        const rowBytes = Math.ceil((width * 1 * 16) / 8);
        const rebuilt = withIdatStream(original, chunks, deflateSync(Buffer.alloc(height * (1 + rowBytes))));
        const lied = Buffer.from(rebuilt);
        lied.writeUInt8(16, ihdr.offset + 8 + 8);
        lied.writeUInt8(3, ihdr.offset + 8 + 9);
        return withRepairedCrc(lied, ihdr);
      });
    },
    240_000,
  );
});
