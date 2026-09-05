// Structural validation of stored cover bytes (W2H.5, W2I.4). The covers route
// must decide, from the bytes alone and before it sets `Content-Type: image/png`,
// whether what it holds is an image a browser can render.

import { crc32, inflateSync } from 'node:zlib';

/** The 8 bytes every PNG file opens with. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Each chunk opens with a 4-byte big-endian data length and a 4-byte type. */
const CHUNK_HEADER_BYTES = 8;
/** Each chunk closes with the CRC-32 of its type and data. */
const CHUNK_CRC_BYTES = 4;
/** IHDR carries width, height, bit depth, colour type, compression, filter, interlace. */
const IHDR_DATA_BYTES = 13;
/** A chunk length is a 31-bit value: the PNG spec reserves the high bit. */
const MAX_CHUNK_DATA_BYTES = 0x7fffffff;

/** Byte offsets of the fields inside IHDR's 13 data bytes. */
const IHDR_WIDTH_OFFSET = 0;
const IHDR_HEIGHT_OFFSET = 4;
const IHDR_BIT_DEPTH_OFFSET = 8;
const IHDR_COLOUR_TYPE_OFFSET = 9;
const IHDR_INTERLACE_OFFSET = 12;

/** How one colour type lays its samples out. */
interface ColourTypeLayout {
  /** Samples per pixel. */
  channels: number;
  /** The bit depths the PNG format pairs with this colour type, and no others. */
  bitDepths: ReadonlySet<number>;
}

/**
 * The five colour types the PNG format defines, each with the bit depths the
 * format allows it. The pairing is the point: a bit depth that is legal on its
 * own is still not a PNG on the wrong colour type -- indexed colour stops at 8
 * bits per sample, and every colour type carrying alpha starts at 8 -- and a
 * pair the format does not define has no row width to compute from.
 */
const LAYOUT_BY_COLOUR_TYPE: ReadonlyMap<number, ColourTypeLayout> = new Map([
  [0, { channels: 1, bitDepths: new Set([1, 2, 4, 8, 16]) }], // greyscale
  [2, { channels: 3, bitDepths: new Set([8, 16]) }], // truecolour
  [3, { channels: 1, bitDepths: new Set([1, 2, 4, 8]) }], // indexed
  [4, { channels: 2, bitDepths: new Set([8, 16]) }], // greyscale with alpha
  [6, { channels: 4, bitDepths: new Set([8, 16]) }], // truecolour with alpha
]);
/** Interlace method 0: rows in order. Method 1 is Adam7's seven reduced passes. */
const INTERLACE_NONE = 0;

/** The pieces of an intact container the pixel-stream check needs. */
interface IntactPngContainer {
  /** IHDR's 13 data bytes. */
  header: Buffer;
  /** The concatenated IDAT payloads -- the one compressed stream a PNG carries. */
  compressedPixels: Buffer;
}

/**
 * The IHDR data and IDAT stream of a STRUCTURALLY INTACT PNG -- a file whose
 * every chunk is accounted for, from the signature through `IEND`, with no
 * byte unexplained and no chunk's CRC-32 disagreeing with its contents -- or
 * `null` when `bytes` are not one.
 *
 * Checking the file's outer frame -- the signature at the front and `IEND` at
 * the back -- is not enough to establish that, because damage keeps both
 * edges. A byte flipped inside an IDAT chunk, an IHDR whose declared length is
 * not 13, and an IDAT payload truncated in place all leave the first eight and
 * last twelve bytes exactly as the renderer wrote them, and none of the three
 * decodes.
 *
 * So the walk reads the file the way a decoder does: from byte 8, each chunk
 * its declared length of data plus a CRC, the first chunk `IHDR` at its one
 * legal size, at least one `IDAT` to carry pixels, and the last chunk `IEND`
 * landing exactly on the end of the buffer. The CRC-32 of every chunk is
 * recomputed, which is what catches damage inside a chunk that is the right
 * size. This is arithmetic over a few kilobytes -- microseconds per cover, and
 * no image library.
 */
function readIntactContainer(bytes: Buffer): IntactPngContainer | null {
  if (bytes.length < PNG_SIGNATURE.length + CHUNK_HEADER_BYTES + CHUNK_CRC_BYTES) return null;
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;

  let offset = PNG_SIGNATURE.length;
  let header: Buffer | null = null;
  const idatParts: Buffer[] = [];

  while (offset + CHUNK_HEADER_BYTES + CHUNK_CRC_BYTES <= bytes.length) {
    const dataLength = bytes.readUInt32BE(offset);
    if (dataLength > MAX_CHUNK_DATA_BYTES) return null;

    const typeStart = offset + 4;
    const dataStart = offset + CHUNK_HEADER_BYTES;
    const crcStart = dataStart + dataLength;
    const nextOffset = crcStart + CHUNK_CRC_BYTES;
    if (nextOffset > bytes.length) return null;

    // The CRC covers the chunk's type and data, never its length field.
    if (crc32(bytes.subarray(typeStart, crcStart)) !== bytes.readUInt32BE(crcStart)) return null;

    const type = bytes.subarray(typeStart, dataStart).toString('latin1');
    if (!header) {
      if (type !== 'IHDR' || dataLength !== IHDR_DATA_BYTES) return null;
      header = bytes.subarray(dataStart, crcStart);
      // Both dimensions are at least 1 in a PNG. A zero declares an image with
      // no pixels, which no decoder renders however coherent the rest is.
      if (header.readUInt32BE(IHDR_WIDTH_OFFSET) === 0) return null;
      if (header.readUInt32BE(IHDR_HEIGHT_OFFSET) === 0) return null;
    } else if (type === 'IDAT') {
      idatParts.push(bytes.subarray(dataStart, crcStart));
    } else if (type === 'IEND') {
      if (idatParts.length === 0 || nextOffset !== bytes.length) return null;
      return { header, compressedPixels: Buffer.concat(idatParts) };
    }

    offset = nextOffset;
  }

  // The walk ran out of buffer without reaching IEND.
  return null;
}

/**
 * The exact byte length the inflated pixel stream of the image `header`
 * declares must have: one filter byte in front of every row, each row
 * `ceil(width x channels x bitDepth / 8)` bytes wide.
 *
 * `null` means the header declares no layout this arithmetic can honestly
 * describe, and such a header is rejected rather than exempted from the length
 * check (W2J.2). Two headers land there:
 *
 *   - An interlaced one. Adam7's seven reduced passes each carry their own row
 *     padding, so the single-pass figure above does not describe them. This
 *     repository's cover writer, `apps/daemon/src/covers/crop.ts`, produces
 *     non-interlaced sharp PNG output, so no legitimate cover is interlaced and
 *     rejecting the layout costs nothing -- where accepting it would take the
 *     interlace byte's word for a layout the rows are not in.
 *   - A colour type and bit depth the format does not pair. There is no honest
 *     row width for `ceil()` to return, so any figure it did return would be
 *     invented rather than declared.
 *
 * Neither is treated as "unknown, so allow it": a header that lies about
 * either survives every chunk CRC and inflates a full zlib stream, and a
 * decoder still reads nothing from it.
 */
function declaredPixelStreamLength(header: Buffer): number | null {
  if (header.readUInt8(IHDR_INTERLACE_OFFSET) !== INTERLACE_NONE) return null;

  const bitDepth = header.readUInt8(IHDR_BIT_DEPTH_OFFSET);
  const layout = LAYOUT_BY_COLOUR_TYPE.get(header.readUInt8(IHDR_COLOUR_TYPE_OFFSET));
  if (!layout || !layout.bitDepths.has(bitDepth)) return null;

  const width = header.readUInt32BE(IHDR_WIDTH_OFFSET);
  const height = header.readUInt32BE(IHDR_HEIGHT_OFFSET);
  const rowBytes = Math.ceil((width * layout.channels * bitDepth) / 8);
  return height * (1 + rowBytes);
}

/**
 * Whether `bytes` are a cover the route may answer as `image/png`: an intact
 * container whose `IDAT` stream also inflates, and inflates to exactly the
 * image its own `IHDR` declares.
 *
 * INVARIANT: bytes that fail this are not offered to a browser as
 * `image/png`. An `<img>` fires the same `client_resource_error` ->
 * `resource-failed` anomaly for bytes it cannot decode as it does for a 404,
 * so "damaged but served" and "missing" are the same outcome for the client;
 * only bytes that survive this check may be answered as the image.
 *
 * A container walk alone cannot establish that (W2I.4). It recomputes every
 * chunk's CRC, so it sees damage a chunk's own checksum records -- but a CRC is
 * a stored number, and bytes whose payload was corrupted AND whose CRC was
 * recomputed to match are coherent all the way down and still decode to
 * nothing. Two shapes reach that gap: a byte flipped inside the compressed
 * stream with the chunk CRC repaired, and an `IDAT` carrying a complete, valid
 * zlib stream that simply holds fewer scanlines than `IHDR` asks for. So this
 * check reads the pixels the way a decoder reads them -- inflate the one
 * stream the `IDAT` chunks concatenate into, and require the byte count the
 * header's width, height, bit depth, and colour type predict.
 *
 * A third shape reaches it through the header rather than the stream (W2J.2):
 * an `IHDR` that lies about the layout its own rows are in. Flip the interlace
 * byte to 1, or pair a colour type with a bit depth the format does not define,
 * repair the one chunk CRC, and the container is coherent and the stream still
 * inflates -- while `sharp` reads "invalid scanline filter" and "invalid bit
 * depth" respectively. So the header must first declare a layout whose row
 * arithmetic is honest, and only then is the stream judged against it: a
 * `declaredPixelStreamLength` of `null` is a rejection, never a licence to
 * accept whatever inflates.
 *
 * `node:zlib` only, no image library: inflating a cover's few kilobytes is
 * milliseconds, where a full decode through `sharp` would be the heavier and
 * cache-hostile option on a route that answers `no-store`. The declared length
 * also bounds the inflate, so a stream claiming to be far larger than its own
 * header fails on the spot rather than allocating first.
 */
export function isRenderableCoverPng(bytes: Buffer): boolean {
  const container = readIntactContainer(bytes);
  if (!container) return false;

  const declaredLength = declaredPixelStreamLength(container.header);
  if (declaredLength === null) return false;

  let pixels: Buffer;
  try {
    pixels = inflateSync(container.compressedPixels, { maxOutputLength: declaredLength });
  } catch {
    return false;
  }
  return pixels.length === declaredLength;
}
