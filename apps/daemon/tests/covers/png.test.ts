// isIntactPng (W2H.5) -- the check that decides whether stored cover bytes may
// be answered as `image/png`. The route test
// (tests/covers-corrupt-interior.test.ts) pins the HTTP behaviour end to end
// over a real render; this file pins the predicate itself over the damage
// shapes that are awkward to produce through a route.

import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { COVER_PLACEHOLDER_PNG } from '../../src/covers/placeholder.js';
import { isIntactPng } from '../../src/covers/png.js';

let intact: Buffer;

beforeAll(async () => {
  // sharp is the engine apps/daemon/src/covers/crop.ts writes covers with, so
  // its output is the shape isIntactPng must accept.
  intact = await sharp({
    create: { width: 64, height: 40, channels: 3, background: { r: 20, g: 90, b: 200 } },
  })
    .png()
    .toBuffer();
});

interface Chunk {
  offset: number;
  length: number;
  type: string;
}

function chunks(bytes: Buffer): Chunk[] {
  const found: Chunk[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    found.push({ offset, length, type: bytes.subarray(offset + 4, offset + 8).toString('ascii') });
    offset += 12 + length;
  }
  return found;
}

function chunkOf(bytes: Buffer, type: string): Chunk {
  const chunk = chunks(bytes).find((candidate) => candidate.type === type);
  if (!chunk) throw new Error(`fixture has no ${type} chunk`);
  return chunk;
}

/** Rewrites a chunk's CRC so only the edit under test is wrong. */
function withRepairedCrc(bytes: Buffer, chunk: Chunk): Buffer {
  const repaired = Buffer.from(bytes);
  const crcStart = chunk.offset + 8 + chunk.length;
  repaired.writeUInt32BE(crc32(repaired.subarray(chunk.offset + 4, crcStart)), crcStart);
  return repaired;
}

describe('isIntactPng', () => {
  it('accepts the PNG the cover renderer produces', () => {
    expect(isIntactPng(intact)).toBe(true);
  });

  it('accepts the placeholder the route falls back to', () => {
    // A placeholder that failed this check would make the fallback itself the
    // undecodable answer it exists to avoid.
    expect(isIntactPng(COVER_PLACEHOLDER_PNG)).toBe(true);
  });

  it('rejects a byte flipped inside the IDAT payload, frame untouched', () => {
    const idat = chunkOf(intact, 'IDAT');
    const damaged = Buffer.from(intact);
    damaged[idat.offset + 8 + 3] ^= 0xff;
    expect(damaged.subarray(0, 8).equals(intact.subarray(0, 8))).toBe(true);
    expect(damaged.subarray(damaged.length - 8, damaged.length - 4).toString('ascii')).toBe('IEND');
    expect(isIntactPng(damaged)).toBe(false);
  });

  it('rejects an IDAT whose CRC alone was rewritten', () => {
    const idat = chunkOf(intact, 'IDAT');
    const damaged = Buffer.from(intact);
    damaged[idat.offset + 8 + idat.length] ^= 0xff;
    expect(isIntactPng(damaged)).toBe(false);
  });

  it('rejects an IHDR whose declared length is not 13, even with a matching CRC', () => {
    const ihdr = chunkOf(intact, 'IHDR');
    const damaged = Buffer.from(intact);
    damaged.writeUInt32BE(12, ihdr.offset);
    expect(isIntactPng(withRepairedCrc(damaged, { ...ihdr, length: 12 }))).toBe(false);
  });

  it('rejects a chunk length that runs past the end of the buffer', () => {
    const idat = chunkOf(intact, 'IDAT');
    const damaged = Buffer.from(intact);
    damaged.writeUInt32BE(0x0fffffff, idat.offset);
    expect(isIntactPng(damaged)).toBe(false);
  });

  it('rejects a chunk length with the reserved high bit set', () => {
    const idat = chunkOf(intact, 'IDAT');
    const damaged = Buffer.from(intact);
    damaged.writeUInt32BE(0xffffffff, idat.offset);
    expect(isIntactPng(damaged)).toBe(false);
  });

  it('rejects bytes with no IDAT to carry pixels', () => {
    const ihdr = chunkOf(intact, 'IHDR');
    const iend = chunkOf(intact, 'IEND');
    const headerOnly = Buffer.concat([
      intact.subarray(0, ihdr.offset + 12 + ihdr.length),
      intact.subarray(iend.offset),
    ]);
    expect(headerOnly.subarray(headerOnly.length - 8, headerOnly.length - 4).toString('ascii')).toBe('IEND');
    expect(isIntactPng(headerOnly)).toBe(false);
  });

  it('rejects trailing bytes appended after IEND', () => {
    const appended = Buffer.concat([intact, Buffer.from('junk')]);
    expect(isIntactPng(appended)).toBe(false);
  });

  it('rejects a file that stops before IEND', () => {
    const iend = chunkOf(intact, 'IEND');
    expect(isIntactPng(intact.subarray(0, iend.offset))).toBe(false);
  });

  it('rejects an empty read, a foreign file, and a signature with nothing behind it', () => {
    expect(isIntactPng(Buffer.alloc(0))).toBe(false);
    expect(isIntactPng(Buffer.from('<!doctype html><html></html>'))).toBe(false);
    expect(isIntactPng(intact.subarray(0, 8))).toBe(false);
  });
});
