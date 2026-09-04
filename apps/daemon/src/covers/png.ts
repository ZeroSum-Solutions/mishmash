// Structural validation of stored cover bytes (W2H.5). The covers route must
// decide, from the bytes alone and before it sets `Content-Type: image/png`,
// whether what it holds is an image a browser can render.

import { crc32 } from 'node:zlib';

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

/**
 * Whether `bytes` are a STRUCTURALLY INTACT PNG: a file whose every chunk is
 * accounted for, from the signature through `IEND`, with no byte unexplained
 * and no chunk's CRC-32 disagreeing with its contents.
 *
 * INVARIANT: bytes that fail this are not offered to a browser as
 * `image/png`. An `<img>` fires the same `client_resource_error` ->
 * `resource-failed` anomaly for bytes it cannot decode as it does for a 404,
 * so "damaged but served" and "missing" are the same outcome for the client;
 * only bytes that survive this check may be answered as the image.
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
 * no image library -- not a decode: it proves the container is undamaged, and
 * a container that has survived intact carries the pixels the renderer put in
 * it.
 */
export function isIntactPng(bytes: Buffer): boolean {
  if (bytes.length < PNG_SIGNATURE.length + CHUNK_HEADER_BYTES + CHUNK_CRC_BYTES) return false;
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return false;

  let offset = PNG_SIGNATURE.length;
  let seenIhdr = false;
  let seenIdat = false;

  while (offset + CHUNK_HEADER_BYTES + CHUNK_CRC_BYTES <= bytes.length) {
    const dataLength = bytes.readUInt32BE(offset);
    if (dataLength > MAX_CHUNK_DATA_BYTES) return false;

    const typeStart = offset + 4;
    const dataStart = offset + CHUNK_HEADER_BYTES;
    const crcStart = dataStart + dataLength;
    const nextOffset = crcStart + CHUNK_CRC_BYTES;
    if (nextOffset > bytes.length) return false;

    // The CRC covers the chunk's type and data, never its length field.
    if (crc32(bytes.subarray(typeStart, crcStart)) !== bytes.readUInt32BE(crcStart)) return false;

    const type = bytes.subarray(typeStart, dataStart).toString('latin1');
    if (!seenIhdr) {
      if (type !== 'IHDR' || dataLength !== IHDR_DATA_BYTES) return false;
      seenIhdr = true;
    } else if (type === 'IDAT') {
      seenIdat = true;
    } else if (type === 'IEND') {
      return seenIdat && nextOffset === bytes.length;
    }

    offset = nextOffset;
  }

  // The walk ran out of buffer without reaching IEND.
  return false;
}
