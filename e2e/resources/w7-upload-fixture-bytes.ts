// Deterministic fixture-byte generator for `w7-upload-manifest.ts` (F-01
// upload progress/limit e2e spec). D-18: bytes are never committed as a
// binary — this script regenerates the exact same content at any size, so
// the manifest's recorded SHA-256 is reproducible from source alone.
//
// Content is pure ASCII (a repeating 16-byte pattern), which satisfies the
// daemon's `sniff: 'text'` class for a `.txt` upload (valid UTF-8, no magic
// number) regardless of size.
//
// Capture command for a manifest row of `sizeBytes` N (also recorded per-row
// in w7-upload-manifest.ts):
//   node --experimental-strip-types -e \
//     "import('./w7-upload-fixture-bytes.ts').then(m => { \
//        const b = m.generateUploadFixtureBytes(N); \
//        console.log(require('node:crypto').createHash('sha256').update(b).digest('hex')); \
//      })"

const PATTERN = 'MishMashW7Upload'; // 16 ASCII bytes; repeats without remainder bias

export function generateUploadFixtureBytes(sizeBytes: number): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  for (let i = 0; i < sizeBytes; i += 1) {
    buf[i] = PATTERN.charCodeAt(i % PATTERN.length);
  }
  return buf;
}
