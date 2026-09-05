// isRenderableCoverPng (W2H.5, W2I.4) -- the check that decides whether stored
// cover bytes may be answered as `image/png`. The route tests
// (tests/covers-corrupt-interior.test.ts, tests/covers-crc-coherent-
// undecodable.test.ts) pin the HTTP behaviour end to end over a real render;
// this file pins the predicate itself over the damage shapes that are awkward
// to produce through a route.

import { crc32, deflateSync, inflateSync } from 'node:zlib';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { COVER_PLACEHOLDER_PNG } from '../../src/covers/placeholder.js';
import { isRenderableCoverPng } from '../../src/covers/png.js';

let intact: Buffer;
let interlaced: Buffer;

beforeAll(async () => {
  // sharp is the engine apps/daemon/src/covers/crop.ts writes covers with, so
  // its output is the shape isRenderableCoverPng must accept.
  intact = await sharp({
    create: { width: 64, height: 40, channels: 3, background: { r: 20, g: 90, b: 200 } },
  })
    .png()
    .toBuffer();
  // The same image written with Adam7 interlacing, whose inflated length the
  // predicate deliberately declines to predict.
  interlaced = await sharp({
    create: { width: 64, height: 40, channels: 3, background: { r: 20, g: 90, b: 200 } },
  })
    .png({ progressive: true })
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

/** Inverts the byte at `offset`, in place. */
function flipByte(bytes: Buffer, offset: number): void {
  bytes.writeUInt8(bytes.readUInt8(offset) ^ 0xff, offset);
}

/** Rewrites a chunk's CRC so only the edit under test is wrong. */
function withRepairedCrc(bytes: Buffer, chunk: Chunk): Buffer {
  const repaired = Buffer.from(bytes);
  const crcStart = chunk.offset + 8 + chunk.length;
  repaired.writeUInt32BE(crc32(repaired.subarray(chunk.offset + 4, crcStart)), crcStart);
  return repaired;
}

/** The concatenated IDAT payloads -- the one compressed stream a PNG carries. */
function idatStream(bytes: Buffer): Buffer {
  return Buffer.concat(
    chunks(bytes)
      .filter((chunk) => chunk.type === 'IDAT')
      .map((chunk) => bytes.subarray(chunk.offset + 8, chunk.offset + 8 + chunk.length)),
  );
}

/** Replaces every IDAT chunk with one carrying `payload`, CRC recomputed. */
function withIdatStream(bytes: Buffer, payload: Buffer): Buffer {
  const idats = chunks(bytes).filter((chunk) => chunk.type === 'IDAT');
  const first = idats[0] as Chunk;
  const last = idats[idats.length - 1] as Chunk;
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

/** Whether a real PNG decoder can turn `bytes` into pixels, as an `<img>` must. */
async function decodesToPixels(bytes: Buffer): Promise<boolean> {
  try {
    await sharp(bytes).raw().toBuffer();
    return true;
  } catch {
    return false;
  }
}

/** Rewrites IHDR's 13 data bytes through `edit`, with the chunk CRC repaired. */
function withEditedHeader(bytes: Buffer, edit: (header: Buffer) => void): Buffer {
  const ihdr = chunkOf(bytes, 'IHDR');
  const edited = Buffer.from(bytes);
  edit(edited.subarray(ihdr.offset + 8, ihdr.offset + 8 + ihdr.length));
  return withRepairedCrc(edited, ihdr);
}

describe('isRenderableCoverPng', () => {
  it('accepts the PNG the cover renderer produces', () => {
    expect(isRenderableCoverPng(intact)).toBe(true);
  });

  it('accepts the placeholder the route falls back to', () => {
    // A placeholder that failed this check would make the fallback itself the
    // undecodable answer it exists to avoid.
    expect(isRenderableCoverPng(COVER_PLACEHOLDER_PNG)).toBe(true);
  });

  it('rejects a byte flipped inside the IDAT payload, frame untouched', () => {
    const idat = chunkOf(intact, 'IDAT');
    const damaged = Buffer.from(intact);
    flipByte(damaged, idat.offset + 8 + 3);
    expect(damaged.subarray(0, 8).equals(intact.subarray(0, 8))).toBe(true);
    expect(damaged.subarray(damaged.length - 8, damaged.length - 4).toString('ascii')).toBe('IEND');
    expect(isRenderableCoverPng(damaged)).toBe(false);
  });

  it('rejects an IDAT whose CRC alone was rewritten', () => {
    const idat = chunkOf(intact, 'IDAT');
    const damaged = Buffer.from(intact);
    flipByte(damaged, idat.offset + 8 + idat.length);
    expect(isRenderableCoverPng(damaged)).toBe(false);
  });

  it('rejects an IHDR whose declared length is not 13, even with a matching CRC', () => {
    const ihdr = chunkOf(intact, 'IHDR');
    const damaged = Buffer.from(intact);
    damaged.writeUInt32BE(12, ihdr.offset);
    expect(isRenderableCoverPng(withRepairedCrc(damaged, { ...ihdr, length: 12 }))).toBe(false);
  });

  it('rejects a chunk length that runs past the end of the buffer', () => {
    const idat = chunkOf(intact, 'IDAT');
    const damaged = Buffer.from(intact);
    damaged.writeUInt32BE(0x0fffffff, idat.offset);
    expect(isRenderableCoverPng(damaged)).toBe(false);
  });

  it('rejects a chunk length with the reserved high bit set', () => {
    const idat = chunkOf(intact, 'IDAT');
    const damaged = Buffer.from(intact);
    damaged.writeUInt32BE(0xffffffff, idat.offset);
    expect(isRenderableCoverPng(damaged)).toBe(false);
  });

  it('rejects bytes with no IDAT to carry pixels', () => {
    const ihdr = chunkOf(intact, 'IHDR');
    const iend = chunkOf(intact, 'IEND');
    const headerOnly = Buffer.concat([
      intact.subarray(0, ihdr.offset + 12 + ihdr.length),
      intact.subarray(iend.offset),
    ]);
    expect(headerOnly.subarray(headerOnly.length - 8, headerOnly.length - 4).toString('ascii')).toBe('IEND');
    expect(isRenderableCoverPng(headerOnly)).toBe(false);
  });

  it('rejects trailing bytes appended after IEND', () => {
    const appended = Buffer.concat([intact, Buffer.from('junk')]);
    expect(isRenderableCoverPng(appended)).toBe(false);
  });

  it('rejects a file that stops before IEND', () => {
    const iend = chunkOf(intact, 'IEND');
    expect(isRenderableCoverPng(intact.subarray(0, iend.offset))).toBe(false);
  });

  it('rejects an empty read, a foreign file, and a signature with nothing behind it', () => {
    expect(isRenderableCoverPng(Buffer.alloc(0))).toBe(false);
    expect(isRenderableCoverPng(Buffer.from('<!doctype html><html></html>'))).toBe(false);
    expect(isRenderableCoverPng(intact.subarray(0, 8))).toBe(false);
  });

  // W2I.4: the container above is coherent in every one of these -- every
  // chunk length adds up and every CRC agrees -- and the pixels are still
  // unreadable.

  it('rejects a byte flipped inside the IDAT payload with the chunk CRC repaired', () => {
    const idat = chunkOf(intact, 'IDAT');
    const flipped = Buffer.from(intact);
    flipByte(flipped, idat.offset + 8 + 3);
    const damaged = withRepairedCrc(flipped, idat);
    expect(crc32(damaged.subarray(idat.offset + 4, idat.offset + 8 + idat.length))).toBe(
      damaged.readUInt32BE(idat.offset + 8 + idat.length),
    );
    expect(isRenderableCoverPng(damaged)).toBe(false);
  });

  it('rejects an IDAT whose valid zlib stream inflates to fewer bytes than IHDR declares', () => {
    const raw = inflateSync(idatStream(intact));
    const short = deflateSync(raw.subarray(0, raw.length - (1 + 64 * 3)));
    expect(inflateSync(short).length).toBeLessThan(raw.length);
    expect(isRenderableCoverPng(withIdatStream(intact, short))).toBe(false);
  });

  it('rejects an IDAT whose valid zlib stream inflates to more bytes than IHDR declares', () => {
    const raw = inflateSync(idatStream(intact));
    const long = deflateSync(Buffer.concat([raw, Buffer.alloc(1 + 64 * 3)]));
    expect(isRenderableCoverPng(withIdatStream(intact, long))).toBe(false);
  });

  it('rejects an IHDR declaring a zero dimension, even with a matching CRC', () => {
    const ihdr = chunkOf(intact, 'IHDR');
    const damaged = Buffer.from(intact);
    damaged.writeUInt32BE(0, ihdr.offset + 8 + 4);
    expect(isRenderableCoverPng(withRepairedCrc(damaged, ihdr))).toBe(false);
  });

  it('rejects an interlaced PNG, a layout no cover this daemon writes is in', () => {
    // This assertion used to claim the opposite -- that an Adam7-interlaced
    // PNG is accepted, because only its length claim was unknown and the
    // stream still inflated. That was the W2J.2 defect: "unknown layout, so
    // allow it" is the allowance an IHDR that merely CLAIMS interlacing walks
    // through, and there is no legitimate cover to protect on the other side
    // of it -- covers/crop.ts writes sharp's non-interlaced PNG output.
    expect(interlaced.readUInt8(8 + 8 + 12), 'the fixture is Adam7-interlaced').toBe(1);
    expect(isRenderableCoverPng(interlaced)).toBe(false);
  });

  it('rejects an interlaced PNG whose stream does not inflate', () => {
    const idat = chunkOf(interlaced, 'IDAT');
    const flipped = Buffer.from(interlaced);
    flipByte(flipped, idat.offset + 8 + 3);
    expect(isRenderableCoverPng(withRepairedCrc(flipped, idat))).toBe(false);
  });

  // W2J.2: the container is coherent, every CRC agrees, and the IDAT stream
  // inflates -- and the IHDR still describes a layout no decoder can read. The
  // pixel-stream length check cannot see either of these on its own, so each
  // case is proved undecodable by sharp, the engine the cover renderer writes
  // with, before the predicate is asked about it.

  it('rejects an IHDR that lies about interlace, with the chunk CRC repaired', async () => {
    const damaged = withEditedHeader(intact, (header) => {
      // IHDR byte 12 is the interlace method. 0 is the single pass the cover
      // renderer writes; 1 claims Adam7's seven reduced passes over rows that
      // were never laid out that way.
      header.writeUInt8(1, 12);
    });
    expect(damaged.length, 'the lie costs no bytes').toBe(intact.length);
    expect(await decodesToPixels(damaged), 'sharp cannot read the lie').toBe(false);
    expect(isRenderableCoverPng(damaged)).toBe(false);
  });

  it('rejects an IHDR pairing colour type 3 with bit depth 16', async () => {
    const ihdr = chunkOf(intact, 'IHDR');
    const width = intact.readUInt32BE(ihdr.offset + 8);
    const height = intact.readUInt32BE(ihdr.offset + 12);
    // The PNG format defines indexed colour at bit depths 1, 2, 4 and 8 only,
    // so this header has no honest row width. The IDAT is rebuilt to exactly
    // the byte count the illegal pair predicts, so what must be caught is the
    // pair itself and not a length mismatch behind it.
    const rowBytes = Math.ceil((width * 1 * 16) / 8);
    const rebuilt = withIdatStream(intact, deflateSync(Buffer.alloc(height * (1 + rowBytes))));
    const damaged = withEditedHeader(rebuilt, (header) => {
      header.writeUInt8(16, 8);
      header.writeUInt8(3, 9);
    });
    expect(await decodesToPixels(damaged), 'sharp cannot read the pair').toBe(false);
    expect(isRenderableCoverPng(damaged)).toBe(false);
  });
});
