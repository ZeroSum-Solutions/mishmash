// Generator for first-party w7-upload fixtures (D-18: generated at test
// time, never committed as binaries). Builds a minimal buffer for every
// accepted kind (real magic bytes / valid UTF-8 text / a real ZIP central
// directory), plus the hostile ZIP shapes the mime-mismatch red spec
// exercises. Capture command for anyone re-deriving these by hand:
//   node --experimental-strip-types -e \
//     "import('./generate.ts').then(m => console.log(m.validPng().length))"
//
// The ZIP writer below deliberately writes ONLY the central-directory shape
// `zip-inspector.ts` reads (never a general-purpose zip library) so a
// hostile fixture can declare sizes/flags/attributes independently of its
// actual bytes — the inspector never inflates entry data, so this is a
// faithful test of what it actually checks.

export function validPng(): Buffer {
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-png-body')]);
}
export function validJpeg(): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake-jpeg-body')]);
}
export function validGif(): Buffer {
  return Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.from('fake-gif-body')]);
}
export function validWebp(): Buffer {
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'ascii'), Buffer.from('body')]);
}
export function validSvg(): Buffer {
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8');
}
export function validMp4(): Buffer {
  return Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42', 'ascii'), Buffer.from('body')]);
}
export function validWebm(): Buffer {
  return Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('body')]);
}
export function validMov(): Buffer {
  return Buffer.concat([Buffer.from([0, 0, 0, 0x14]), Buffer.from('ftypqt  ', 'ascii'), Buffer.from('body')]);
}
export function validMp3(): Buffer {
  return Buffer.concat([Buffer.from('ID3', 'ascii'), Buffer.from([3, 0, 0, 0, 0, 0, 0]), Buffer.from('body')]);
}
export function validWav(): Buffer {
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVE', 'ascii'), Buffer.from('body')]);
}
export function validPdf(): Buffer {
  return Buffer.from('%PDF-1.4\n%body', 'utf8');
}
export function validText(): Buffer {
  return Buffer.from('hello world\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Minimal ZIP builder (store method only; matches `zip-inspector.ts`'s
// reader). One entry per call site's needs — this is a test-only writer,
// not a general-purpose archiver.
// ---------------------------------------------------------------------------

export interface ZipEntrySpec {
  name: string;
  data?: Buffer;
  /** Overrides the declared compressed size in BOTH local + central headers
   *  (independent of `data.length`) — used to fabricate a bomb-ratio entry
   *  without actually writing gigabytes of bytes. */
  compressedSizeOverride?: number;
  /** Overrides the declared uncompressed size similarly. */
  uncompressedSizeOverride?: number;
  method?: number; // 0 = store, 8 = deflate (declared only; bytes are never real deflate data here)
  encryptedFlag?: boolean;
  externalAttrs?: number; // e.g. unix symlink mode << 16
  zip64?: boolean; // adds a bogus zip64 extra field to trip the ZIP64 rejection
}

function crc32(_buf: Buffer): number {
  return 0; // inspector never verifies CRC; kept at 0 for simplicity
}

export function buildZip(entries: ZipEntrySpec[], opts: { truncateCentralDirectory?: boolean } = {}): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const data = entry.data ?? Buffer.alloc(0);
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const method = entry.method ?? 0;
    const compressedSize = entry.compressedSizeOverride ?? data.length;
    const uncompressedSize = entry.uncompressedSizeOverride ?? data.length;
    const flags = entry.encryptedFlag ? 0x1 : 0x0;
    const extra = entry.zip64 ? buildZip64Extra() : Buffer.alloc(0);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(flags, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc32(data), 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(extra.length, 28);
    const localOffset = offset;
    localParts.push(localHeader, nameBuf, extra, data);
    offset += localHeader.length + nameBuf.length + extra.length + data.length;

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(flags, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc32(data), 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(extra.length, 30);
    centralHeader.writeUInt16LE(0, 32); // comment len
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE((entry.externalAttrs ?? 0) >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, nameBuf, extra);
  }

  const centralStart = offset;
  let centralBuf = Buffer.concat(centralParts);
  if (opts.truncateCentralDirectory) {
    // Cut deep enough that the SECOND entry's 46-byte header no longer fits
    // in the buffer at all — the inspector's bounds check
    // (`offset + 46 > zip.length`) then fires immediately, rather than
    // reading a few surviving header bytes followed by stray EOCD bytes
    // misread as a corrupted name (a real but uninteresting failure mode).
    centralBuf = centralBuf.subarray(0, Math.max(0, centralBuf.length - 40));
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function buildZip64Extra(): Buffer {
  const extra = Buffer.alloc(4);
  extra.writeUInt16LE(0x0001, 0);
  extra.writeUInt16LE(0, 2);
  return extra;
}

export function validZip(): Buffer {
  return buildZip([{ name: 'hello.txt', data: Buffer.from('hello from inside the zip', 'utf8') }]);
}

export function zipWithTraversalEntry(): Buffer {
  return buildZip([{ name: '../../etc/evil.txt', data: Buffer.from('x') }]);
}

export function zipWithSymlinkEntry(): Buffer {
  const symlinkMode = 0o120000 << 16;
  return buildZip([{ name: 'link', data: Buffer.from('/etc/passwd'), externalAttrs: symlinkMode }]);
}

export function zipWithExtremeRatioEntry(): Buffer {
  return buildZip([{
    name: 'bomb.bin',
    data: Buffer.from('tiny'),
    method: 8,
    compressedSizeOverride: 100,
    uncompressedSizeOverride: 100 * 1000, // 1000:1, above the 100:1 ceiling
  }]);
}

export function encryptedZip(): Buffer {
  return buildZip([{ name: 'secret.txt', data: Buffer.from('x'), encryptedFlag: true }]);
}

export function zipWithAbsolutePathEntry(): Buffer {
  return buildZip([{ name: '/etc/evil.txt', data: Buffer.from('x') }]);
}

export function zipWithTruncatedCentralDirectory(): Buffer {
  // Two entries so the truncation lands inside the SECOND entry's central
  // header (past the first entry's valid name) — this reliably trips the
  // "malformed or truncated" bounds check instead of accidentally
  // corrupting a name into an unrelated null-byte failure.
  return buildZip(
    [
      { name: 'a.txt', data: Buffer.from('x') },
      { name: 'b.txt', data: Buffer.from('y') },
    ],
    { truncateCentralDirectory: true },
  );
}

export function zip64Zip(): Buffer {
  return buildZip([{ name: 'a.txt', data: Buffer.from('x'), zip64: true }]);
}
