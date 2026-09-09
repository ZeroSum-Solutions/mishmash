// Bounded ZIP central-directory inspector for uploaded archives (Part 2 item
// 2.17, re-derived — nothing copied from ONE BOX). Strengthens the parser at
// `apps/daemon/src/design/claude-design-import.ts:183-261` (verified on
// base; its ceilings at lines 10-12: MAX_FILES 5000, MAX_TOTAL_BYTES 100MiB,
// MAX_FILE_BYTES 25MiB) with the wider ceilings and hostile-entry rejections
// an untrusted user upload needs.
//
// INVARIANT: this module NEVER extracts or inflates entry bytes. It parses
// only the central directory (names, sizes, flags, external attributes) and
// answers whether the archive is safe to accept. Actual promotion copies the
// staged .zip file itself into the project; nothing inside it is unpacked.

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const CENTRAL_SIG = 0x02014b50;
const ZIP64_EXTRA_ID = 0x0001;

export const ZIP_MAX_ENTRIES = 10_000;
export const ZIP_MAX_TOTAL_DECODED_BYTES = 2 * 1024 * 1024 * 1024;
export const ZIP_MAX_ENTRY_DECODED_BYTES = 512 * 1024 * 1024;
export const ZIP_MAX_COMPRESSION_RATIO = 100;

export interface ZipInspectionOptions {
  /** Per-entry compressed-byte ceiling — the upload's own per-file limit. */
  maxEntryCompressedBytes: number;
}

export interface ZipInspectionEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  isDirectory: boolean;
}

export type ZipInspectionResult =
  | { ok: true; entries: ZipInspectionEntry[] }
  | { ok: false; reason: string };

/** Parses the ZIP central directory in `zip` and rejects anything a hostile
 *  archive could use to escape the staging sandbox or exhaust resources:
 *  encrypted entries, absolute/drive paths, traversal (`..`), symlink
 *  external attributes, ZIP64, a malformed/truncated directory, too many
 *  entries, an oversized entry, an oversized total, or an extreme
 *  compression ratio (a zip-bomb signature). Never inflates entry bytes. */
export function inspectZipCentralDirectory(zip: Buffer, opts: ZipInspectionOptions): ZipInspectionResult {
  let eocdOffset: number;
  try {
    eocdOffset = findEndOfCentralDirectory(zip);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }

  // ZIP64 end-of-central-directory locator sits 20 bytes before the EOCD
  // record when present. We reject ZIP64 archives outright rather than
  // parsing the ZIP64 extra fields, per spec.
  const locatorOffset = eocdOffset - 20;
  if (locatorOffset >= 0 && zip.length >= locatorOffset + 4 && zip.readUInt32LE(locatorOffset) === EOCD64_LOCATOR_SIG) {
    return { ok: false, reason: 'zip64 archives are not supported' };
  }

  let entryCount: number;
  let centralSize: number;
  let centralOffset: number;
  try {
    entryCount = zip.readUInt16LE(eocdOffset + 10);
    centralSize = zip.readUInt32LE(eocdOffset + 12);
    centralOffset = zip.readUInt32LE(eocdOffset + 16);
  } catch {
    return { ok: false, reason: 'malformed zip end-of-central-directory record' };
  }
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    return { ok: false, reason: 'zip64 archives are not supported' };
  }
  if (entryCount > ZIP_MAX_ENTRIES) {
    return { ok: false, reason: `zip has too many entries (max ${ZIP_MAX_ENTRIES})` };
  }
  if (centralOffset + centralSize > zip.length || centralOffset < 0) {
    return { ok: false, reason: 'truncated or malformed zip central directory' };
  }

  const entries: ZipInspectionEntry[] = [];
  let totalDecoded = 0;
  let offset = centralOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== CENTRAL_SIG) {
      return { ok: false, reason: 'malformed or truncated zip central directory entry' };
    }
    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const uncompressedSize = zip.readUInt32LE(offset + 24);
    const nameLen = zip.readUInt16LE(offset + 28);
    const extraLen = zip.readUInt16LE(offset + 30);
    const commentLen = zip.readUInt16LE(offset + 32);
    const externalAttrs = zip.readUInt32LE(offset + 38);
    if (offset + 46 + nameLen + extraLen + commentLen > zip.length) {
      return { ok: false, reason: 'malformed or truncated zip central directory entry' };
    }
    const nameBytes = zip.subarray(offset + 46, offset + 46 + nameLen);
    const name = nameBytes.toString('utf8');
    const extra = zip.subarray(offset + 46 + nameLen, offset + 46 + nameLen + extraLen);

    if ((flags & 0x1) !== 0) return { ok: false, reason: `encrypted zip entry: ${name}` };
    if (hasZip64Extra(extra)) return { ok: false, reason: 'zip64 archives are not supported' };
    if (method !== 0 && method !== 8) return { ok: false, reason: `unsupported zip compression method: ${method}` };

    const pathIssue = checkZipEntryPath(name);
    if (pathIssue) return { ok: false, reason: pathIssue };

    // Unix external attributes: high 16 bits hold the st_mode; 0o120000 is
    // S_IFLNK. A symlink entry could point outside the staging sandbox once
    // (if ever) resolved by a consumer, so it is rejected unconditionally —
    // this inspector never follows or resolves it either.
    const unixMode = externalAttrs >>> 16;
    if ((unixMode & 0o170000) === 0o120000) {
      return { ok: false, reason: `symlink zip entry rejected: ${name}` };
    }

    if (compressedSize > opts.maxEntryCompressedBytes) {
      return { ok: false, reason: `zip entry exceeds the per-file limit: ${name}` };
    }
    if (uncompressedSize > ZIP_MAX_ENTRY_DECODED_BYTES) {
      return { ok: false, reason: `zip entry decodes too large: ${name}` };
    }
    if (compressedSize > 0 && uncompressedSize / compressedSize > ZIP_MAX_COMPRESSION_RATIO) {
      return { ok: false, reason: `zip entry compression ratio too extreme (possible zip bomb): ${name}` };
    }

    totalDecoded += uncompressedSize;
    if (totalDecoded > ZIP_MAX_TOTAL_DECODED_BYTES) {
      return { ok: false, reason: 'zip total decoded size exceeds the limit' };
    }

    entries.push({ name, compressedSize, uncompressedSize, isDirectory: name.endsWith('/') });
    offset += 46 + nameLen + extraLen + commentLen;
  }

  return { ok: true, entries };
}

function hasZip64Extra(extra: Buffer): boolean {
  let i = 0;
  while (i + 4 <= extra.length) {
    const id = extra.readUInt16LE(i);
    const size = extra.readUInt16LE(i + 2);
    if (id === ZIP64_EXTRA_ID) return true;
    i += 4 + size;
  }
  return false;
}

function checkZipEntryPath(name: string): string | null {
  if (!name) return 'zip entry has an empty name';
  if (name.includes('\0')) return `zip entry has a null byte in its name: ${name}`;
  const normalized = name.replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(normalized) || normalized.startsWith('/')) {
    return `zip entry has an absolute path: ${name}`;
  }
  const segments = normalized.split('/');
  if (segments.some((seg) => seg === '..')) {
    return `zip entry attempts path traversal: ${name}`;
  }
  return null;
}

function findEndOfCentralDirectory(zip: Buffer): number {
  const min = Math.max(0, zip.length - 0xffff - 22);
  for (let i = zip.length - 22; i >= min; i -= 1) {
    if (zip.readUInt32LE(i) === EOCD_SIG) return i;
  }
  throw new Error('invalid zip: missing central directory');
}
