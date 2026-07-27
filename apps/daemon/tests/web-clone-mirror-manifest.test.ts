import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Capture-hardening (docket mishmash-docket-1-7), round-3 adversarial review's
// headline structural fix (N1/N2/N3/F10/F11): capture, recursive fetch, and
// rewrite used to each independently RECOMPUTE a URL's local path (or
// reconstruct a URL back out of a local path to refetch it) via a
// shared-but-lossy pure function. This exercises the two new modules that
// replace that pattern:
//   - lib/safe-path.mjs's containedPath -- the write-side traversal guard
//     (N1: `%2e%2e%2f%2e%2e%2fescape.txt` decodes into literal ".." segments
//     that `path.join`/`path.resolve` will happily walk outside the mirror
//     root without this check).
//   - lib/mirror-manifest.mjs's createMirrorManifest -- the single
//     sourceUrl<->localPath source of truth. A colliding "natural" path
//     gets disambiguated with a hash of the url rather than letting a
//     second write silently reuse the first write's file (safe for
//     accidental collisions; deliberately crafted double-collisions are a
//     documented SKILL.md limitation, not a defended case). Plus
//     findMissingSourceUrls/isCaptured, which return
//     fetchable absolute URLs directly (never a locally-computed path
//     reconstructed back into a guessed URL) and treat a claimed-but-never-
//     written URL as still missing (retry-able across rounds).
const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const safePathScriptPath = path.join(repoRoot, 'skills', 'web-clone', 'scripts', 'lib', 'safe-path.mjs');
const mirrorManifestScriptPath = path.join(
  repoRoot,
  'skills',
  'web-clone',
  'scripts',
  'lib',
  'mirror-manifest.mjs',
);
const rewriteMirrorScriptPath = path.join(repoRoot, 'skills', 'web-clone', 'scripts', 'rewrite-mirror.mjs');

async function loadSafePath() {
  return (await import(pathToFileURL(safePathScriptPath).href)) as {
    containedPath: (root: string, rel: string) => string | null;
  };
}

interface MirrorManifest {
  claim: (url: string, hosts: Set<string>) => string | null;
  get: (url: string) => string | undefined;
  has: (url: string) => boolean;
  reverseGet: (localPath: string) => string | undefined;
  entries: () => [string, string][];
  toJSON: () => { sourceUrl: string; localPath: string }[];
  restore: (entries: { sourceUrl: string; localPath: string }[]) => void;
}

async function loadMirrorManifest() {
  return (await import(pathToFileURL(mirrorManifestScriptPath).href)) as {
    createMirrorManifest: (deps: {
      computeLocalPath: (url: string, hosts: Set<string>) => string | null;
    }) => MirrorManifest;
    loadMirrorManifest: (
      json: unknown,
      deps: { computeLocalPath: (url: string, hosts: Set<string>) => string | null },
    ) => MirrorManifest;
    findMissingSourceUrls: (args: { siteDir: string; hosts: Set<string>; manifest: MirrorManifest }) => Set<string>;
    isCaptured: (args: { siteDir: string; manifest: MirrorManifest; url: string }) => boolean;
  };
}

async function loadRewriteMirror() {
  return (await import(pathToFileURL(rewriteMirrorScriptPath).href)) as {
    localPathForUrl: (url: string, hosts: Set<string>) => string | null;
    originHosts: (origin: string) => Set<string>;
    rewriteMirror: (args: {
      siteDir: string;
      origin: string;
      manifest?: MirrorManifest | null;
      dryRun?: boolean;
    }) => { rewritten: number; notMirrored: number; filesChanged: number };
  };
}

describe('containedPath (lib/safe-path.mjs, N1: write-side traversal guard)', () => {
  it('resolves a normal nested relative path under root', async () => {
    const { containedPath } = await loadSafePath();
    const root = '/mirror/site';

    expect(containedPath(root, 'images/logo.png')).toBe(path.resolve(root, 'images/logo.png'));
  });

  // N1's exact reviewer probe: a percent-encoded traversal sequence that
  // decodes into literal ".." components must not be allowed to write
  // outside the mirror root.
  it('(N1) rejects a decoded ../../ traversal sequence', async () => {
    const { containedPath } = await loadSafePath();
    const root = '/mirror/site';

    expect(containedPath(root, '../../escape.txt')).toBeNull();
    expect(containedPath(root, '../../../etc/passwd')).toBeNull();
  });

  it('(N1) rejects an absolute path that would escape root via path.resolve', async () => {
    const { containedPath } = await loadSafePath();

    expect(containedPath('/mirror/site', '/etc/passwd')).toBeNull();
  });

  it('rejects an empty or non-string rel', async () => {
    const { containedPath } = await loadSafePath();

    expect(containedPath('/mirror/site', '')).toBeNull();
    expect(containedPath('/mirror/site', undefined as unknown as string)).toBeNull();
  });

  it('allows the root itself (empty-normalized rel)', async () => {
    const { containedPath } = await loadSafePath();

    expect(containedPath('/mirror/site', '.')).toBe(path.resolve('/mirror/site'));
  });
});

describe('createMirrorManifest (lib/mirror-manifest.mjs)', () => {
  it('claim() returns the natural local path for a fresh URL', async () => {
    const { createMirrorManifest } = await loadMirrorManifest();
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });

    const rel = manifest.claim('https://example.com/images/logo.png', hosts);

    expect(rel).toBe('images/logo.png');
    expect(manifest.get('https://example.com/images/logo.png')).toBe(rel);
    expect(manifest.reverseGet(rel!)).toBe('https://example.com/images/logo.png');
  });

  it('claim() is idempotent: re-claiming the same URL returns the same path without re-deriving it', async () => {
    const { createMirrorManifest } = await loadMirrorManifest();
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });

    const first = manifest.claim('https://example.com/theme.css?mode=dark', hosts);
    const second = manifest.claim('https://example.com/theme.css?mode=dark', hosts);

    expect(second).toBe(first);
  });

  // The reviewer's exact injectivity scenario (N1's other half): two
  // DIFFERENT source URLs whose decoded/naturalized path collides
  // (`/models/a%2Fb.buf` and `/models/a/b.buf` both decode to
  // "models/a/b.buf") must not be allowed to silently share one file --
  // the second claim disambiguates instead of colliding.
  it('disambiguates two different URLs that collide on the same natural local path', async () => {
    const { createMirrorManifest } = await loadMirrorManifest();
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });

    const first = manifest.claim('https://example.com/models/a%2Fb.buf', hosts);
    const second = manifest.claim('https://example.com/models/a/b.buf', hosts);

    expect(first).toBe('models/a/b.buf');
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    // Both remain independently resolvable.
    expect(manifest.get('https://example.com/models/a%2Fb.buf')).toBe(first);
    expect(manifest.get('https://example.com/models/a/b.buf')).toBe(second);
    expect(manifest.reverseGet(first!)).toBe('https://example.com/models/a%2Fb.buf');
    expect(manifest.reverseGet(second!)).toBe('https://example.com/models/a/b.buf');
  });

  it('toJSON()/restore() round-trip a manifest without overwriting live claims', async () => {
    const { createMirrorManifest } = await loadMirrorManifest();
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });
    manifest.claim('https://example.com/images/logo.png', hosts);
    manifest.claim('https://example.com/models/a%2Fb.buf', hosts);
    manifest.claim('https://example.com/models/a/b.buf', hosts);

    const json = manifest.toJSON();
    const restored = createMirrorManifest({ computeLocalPath: localPathForUrl });
    restored.restore(json);

    expect(restored.toJSON().sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl))).toEqual(
      json.sort((a, b) => a.sourceUrl.localeCompare(b.sourceUrl)),
    );

    // restore() must not clobber an already-live claim for the same URL.
    const live = createMirrorManifest({ computeLocalPath: localPathForUrl });
    const liveClaim = live.claim('https://example.com/images/logo.png', hosts);
    live.restore([{ sourceUrl: 'https://example.com/images/logo.png', localPath: 'DIFFERENT/path.png' }]);
    expect(live.get('https://example.com/images/logo.png')).toBe(liveClaim);
  });

  it('has()/get() report false/undefined for an unclaimed URL', async () => {
    const { createMirrorManifest } = await loadMirrorManifest();
    const { localPathForUrl } = await loadRewriteMirror();
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });

    expect(manifest.has('https://example.com/nope.png')).toBe(false);
    expect(manifest.get('https://example.com/nope.png')).toBeUndefined();
  });
});

describe('isCaptured / findMissingSourceUrls (lib/mirror-manifest.mjs)', () => {
  let siteDir: string;

  beforeEach(() => {
    siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-clone-manifest-'));
  });

  afterEach(() => {
    fs.rmSync(siteDir, { recursive: true, force: true });
  });

  it('isCaptured() is false for a claimed-but-never-written URL (retry-ability)', async () => {
    const { createMirrorManifest, isCaptured } = await loadMirrorManifest();
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });

    // claim() only reserves a path -- a fetch attempt for it may still fail,
    // leaving no file on disk. That must not be conflated with "captured".
    manifest.claim('https://example.com/images/never-written.png', hosts);

    expect(isCaptured({ siteDir, manifest, url: 'https://example.com/images/never-written.png' })).toBe(false);
  });

  it('isCaptured() is true once the claimed file exists on disk with real bytes', async () => {
    const { createMirrorManifest, isCaptured } = await loadMirrorManifest();
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });

    const rel = manifest.claim('https://example.com/images/logo.png', hosts)!;
    fs.mkdirSync(path.dirname(path.join(siteDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(siteDir, rel), 'fake-png-bytes');

    expect(isCaptured({ siteDir, manifest, url: 'https://example.com/images/logo.png' })).toBe(true);
  });

  it('isCaptured() is false for a zero-byte file (an empty write must not count as captured)', async () => {
    const { createMirrorManifest, isCaptured } = await loadMirrorManifest();
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });

    const rel = manifest.claim('https://example.com/images/empty.png', hosts)!;
    fs.mkdirSync(path.dirname(path.join(siteDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(siteDir, rel), '');

    expect(isCaptured({ siteDir, manifest, url: 'https://example.com/images/empty.png' })).toBe(false);
  });

  // N3's exact scenario: a missing reference must be reported as the ORIGINAL
  // absolute source URL (including its query string), never a locally
  // reconstructed path -- otherwise a recursive-fetch caller would refetch
  // `theme.<hash>.css` (a URL that was never real) instead of the genuine
  // `theme.css?mode=dark`.
  it('findMissingSourceUrls() returns the resolved absolute source URL, query string included, not a local path', async () => {
    const { createMirrorManifest, findMissingSourceUrls } = await loadMirrorManifest();
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });

    // The owning document is captured; the CSS it references (with a query
    // string) is not.
    const ownerUrl = 'https://example.com/index.html';
    const ownerRel = manifest.claim(ownerUrl, hosts)!;
    fs.writeFileSync(
      path.join(siteDir, ownerRel),
      `<!doctype html><link rel="stylesheet" href="/theme.css?mode=dark">`,
    );

    const missing = findMissingSourceUrls({ siteDir, hosts, manifest });

    expect([...missing]).toContain('https://example.com/theme.css?mode=dark');
    expect([...missing].some((url) => url.includes('.hash') || /theme\.[0-9a-f]{8}\.css/.test(url))).toBe(false);
  });

  it('findMissingSourceUrls() excludes a reference whose file already exists on disk with real bytes', async () => {
    const { createMirrorManifest, findMissingSourceUrls } = await loadMirrorManifest();
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });

    const ownerUrl = 'https://example.com/index.html';
    const ownerRel = manifest.claim(ownerUrl, hosts)!;
    fs.writeFileSync(path.join(siteDir, ownerRel), `<!doctype html><link rel="stylesheet" href="/theme.css">`);
    const themeRel = manifest.claim('https://example.com/theme.css', hosts)!;
    fs.writeFileSync(path.join(siteDir, themeRel), 'body{}');

    const missing = findMissingSourceUrls({ siteDir, hosts, manifest });

    expect([...missing]).not.toContain('https://example.com/theme.css');
  });

  it('findMissingSourceUrls() still reports a URL that was claimed but whose write never landed (retry across rounds)', async () => {
    const { createMirrorManifest, findMissingSourceUrls } = await loadMirrorManifest();
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });

    const ownerUrl = 'https://example.com/index.html';
    const ownerRel = manifest.claim(ownerUrl, hosts)!;
    fs.writeFileSync(path.join(siteDir, ownerRel), `<!doctype html><link rel="stylesheet" href="/theme.css">`);
    // Simulate a failed fetch attempt: claim() was called (as mirror-site.mjs
    // does before attempting the fetch, to know where to write on success),
    // but no file was ever written.
    manifest.claim('https://example.com/theme.css', hosts);

    const missing = findMissingSourceUrls({ siteDir, hosts, manifest });

    expect([...missing]).toContain('https://example.com/theme.css');
  });

  it('findMissingSourceUrls() skips a file with no manifest entry (unknown owner, honest gap)', async () => {
    const { createMirrorManifest, findMissingSourceUrls } = await loadMirrorManifest();
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });

    // A hand-added file with no corresponding manifest entry.
    fs.writeFileSync(path.join(siteDir, 'orphan.html'), `<link rel="stylesheet" href="/never-known.css">`);

    const missing = findMissingSourceUrls({ siteDir, hosts, manifest });

    expect([...missing]).toHaveLength(0);
  });
});

// --- Class-A close-out (wave W-C, criteria CC-1/CC-6): manifest identity ---
//
// Round-3 REJECT items A4/A5/A6. Each red spec below fails on parent
// 371daca15 and passes at head -- see proof/CC-1-red.txt / CC-1-green.txt in
// the goal-state run directory.
describe('(A4) fragment references share the fragment-free manifest identity', () => {
  it('(A4) get()/has() find a claimed URL when queried with a #fragment appended', async () => {
    const { createMirrorManifest } = await loadMirrorManifest();
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });

    const bare = manifest.claim('https://example.com/sprite.svg', hosts);

    expect(manifest.get('https://example.com/sprite.svg#icon-menu')).toBe(bare);
    expect(manifest.has('https://example.com/sprite.svg#icon-close')).toBe(true);
  });

  it('(A4) claiming a #fragment variant of an already-claimed URL reuses the entry instead of duplicating the file', async () => {
    const { createMirrorManifest } = await loadMirrorManifest();
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });

    const bare = manifest.claim('https://example.com/sprite.svg', hosts);
    const fragged = manifest.claim('https://example.com/sprite.svg#icon-menu', hosts);

    expect(fragged).toBe(bare);
    expect(manifest.entries()).toHaveLength(1);
  });

  it('(A4) findMissingSourceUrls() does not report a #fragment reference whose fragment-free asset is already captured', async () => {
    const { createMirrorManifest, findMissingSourceUrls } = await loadMirrorManifest();
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });
    const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-clone-fragment-'));
    try {
      const indexRel = manifest.claim('https://example.com/', hosts)!;
      fs.writeFileSync(
        path.join(siteDir, indexRel),
        '<!doctype html><html><body><svg><use href="/sprite.svg#icon-menu"></use></svg></body></html>',
      );
      const spriteRel = manifest.claim('https://example.com/sprite.svg', hosts)!;
      fs.writeFileSync(path.join(siteDir, spriteRel), '<svg><symbol id="icon-menu"/></svg>');

      const missing = findMissingSourceUrls({ siteDir, hosts, manifest });

      expect([...missing]).toHaveLength(0);
    } finally {
      fs.rmSync(siteDir, { recursive: true, force: true });
    }
  });
});

describe('(A5) filesystem-equivalent local paths must not silently collide', () => {
  it('(A5) case-only distinct URLs get case-insensitively distinct local paths (APFS/NTFS are case-insensitive)', async () => {
    const { createMirrorManifest } = await loadMirrorManifest();
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });

    const upper = manifest.claim('https://example.com/Images/Logo.png', hosts)!;
    const lower = manifest.claim('https://example.com/images/logo.png', hosts)!;

    expect(upper.toLowerCase()).not.toBe(lower.toLowerCase());
  });

  it('(A5) NFC/NFD-equivalent URLs get normalization-insensitively distinct local paths (APFS normalizes)', async () => {
    const { createMirrorManifest } = await loadMirrorManifest();
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });

    const nfc = manifest.claim(`https://example.com/${encodeURIComponent('café.png'.normalize('NFC'))}`, hosts)!;
    const nfd = manifest.claim(`https://example.com/${encodeURIComponent('café.png'.normalize('NFD'))}`, hosts)!;

    expect(nfc.normalize('NFC').toLowerCase()).not.toBe(nfd.normalize('NFC').toLowerCase());
  });
});

// Round-1 review of the close-out (Sol, task-ms2t0izc-rdlyna) finding 2:
// `toLowerCase()` is not Unicode case folding -- Greek final sigma `ς`
// lowercases to itself while `Σ` lowercases to `σ`, so `/ΟΣ.png` and
// `/Ος.png` produced distinct collision keys for what a caseless
// filesystem folds into one file.
describe('(A5 round-1) collision keys use Unicode case folding, not toLowerCase()', () => {
  it('final-sigma and sigma variants of one name get distinct local paths', async () => {
    const { createMirrorManifest } = await loadMirrorManifest();
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });

    const capital = manifest.claim(`https://example.com/${encodeURIComponent('ΟΣ.png')}`, hosts)!;
    const finalSigma = manifest.claim(`https://example.com/${encodeURIComponent('Ος.png')}`, hosts)!;

    // Case-fold both (upper-then-lower folds ς and σ together, matching the
    // filesystem's caseless comparison) -- the assigned paths must differ
    // under THAT equivalence, not merely as raw strings.
    expect(capital.normalize('NFC').toUpperCase().toLowerCase()).not.toBe(
      finalSigma.normalize('NFC').toUpperCase().toLowerCase(),
    );
  });
});

// Round-1 review of the close-out (Sol, task-ms2t0izc-rdlyna) finding 4:
// discovery tokenizes unquoted srcset (A7) and capture fetches both
// candidates, but the rewrite pass only matched QUOTED attribute values --
// so the absolute references stayed pointed at the live origin and
// verification reported an origin leak over a mirror whose assets were all
// present locally.
describe('(A7 round-1) rewriteMirror localizes unquoted attribute values, emitting them quoted', () => {
  it('rewrites an unquoted absolute srcset and quotes the result', async () => {
    const { createMirrorManifest } = await loadMirrorManifest();
    const { localPathForUrl, originHosts, rewriteMirror } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });
    const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-clone-unquoted-rewrite-'));
    try {
      const indexRel = manifest.claim('https://example.com/', hosts)!;
      const aRel = manifest.claim('https://example.com/img/a.png', hosts)!;
      const bRel = manifest.claim('https://example.com/img/b.png', hosts)!;
      fs.mkdirSync(path.join(siteDir, 'img'), { recursive: true });
      fs.writeFileSync(
        path.join(siteDir, indexRel),
        '<!doctype html><html><body><img srcset=https://example.com/img/a.png,https://example.com/img/b.png alt="x"></body></html>',
      );
      fs.writeFileSync(path.join(siteDir, aRel), 'png-a');
      fs.writeFileSync(path.join(siteDir, bRel), 'png-b');

      const result = rewriteMirror({ siteDir, origin: 'https://example.com', manifest });

      const html = fs.readFileSync(path.join(siteDir, indexRel), 'utf8');
      expect(result.filesChanged).toBe(1);
      expect(html).not.toContain('https://example.com/img/');
      expect(html).toMatch(/srcset="[^"]*a\.png[^"]*,[^"]*b\.png[^"]*"/);
    } finally {
      fs.rmSync(siteDir, { recursive: true, force: true });
    }
  });
});

// Round-2 review (Sol, task-ms2tn7qr-v562an) sole finding: the unquoted
// rewrite pass scanned unrestricted text, so a `src=https://...` token
// INSIDE another quoted attribute value would be rewritten -- injecting
// quotes into that value and corrupting the markup.
describe('(A7 round-2) unquoted rewrite must not touch tokens inside quoted attribute values', () => {
  it('leaves a src= token embedded in a quoted data-config value byte-identical, while still rewriting a real unquoted src', async () => {
    const { createMirrorManifest } = await loadMirrorManifest();
    const { localPathForUrl, originHosts, rewriteMirror } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });
    const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-clone-quoted-embed-'));
    try {
      const indexRel = manifest.claim('https://example.com/', hosts)!;
      const aRel = manifest.claim('https://example.com/img/a.png', hosts)!;
      fs.mkdirSync(path.join(siteDir, 'img'), { recursive: true });
      const embedded = 'data-config="mode=preview src=https://example.com/img/a.png note=kept"';
      fs.writeFileSync(
        path.join(siteDir, indexRel),
        `<!doctype html><html><body><div ${embedded}></div><img src=https://example.com/img/a.png alt="x"></body></html>`,
      );
      fs.writeFileSync(path.join(siteDir, aRel), 'png-a');

      rewriteMirror({ siteDir, origin: 'https://example.com', manifest });

      const html = fs.readFileSync(path.join(siteDir, indexRel), 'utf8');
      // The quoted data-config value is opaque prose to the rewriter --
      // byte-identical, no injected quotes.
      expect(html).toContain(embedded);
      // The genuine unquoted attribute still gets localized and quoted.
      expect(html).toMatch(/<img src="\.\/img\/a\.png" alt="x">/);
    } finally {
      fs.rmSync(siteDir, { recursive: true, force: true });
    }
  });
});

// Confirmation-pass probes (Sol, task-ms2u05gz-z1auq4): the quoted-span mask
// must also treat framework-syntax attribute names and HTML comments as
// opaque. Both probes reproduced real corruption/miss cases against the
// first mask.
describe('(A7 confirmation) mask covers framework-name attributes and HTML comments', () => {
  it('leaves a src= token inside a framework-syntax quoted attribute (@config="...") byte-identical', async () => {
    const { createMirrorManifest } = await loadMirrorManifest();
    const { localPathForUrl, originHosts, rewriteMirror } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });
    const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-clone-at-attr-'));
    try {
      const indexRel = manifest.claim('https://example.com/', hosts)!;
      const aRel = manifest.claim('https://example.com/img/a.png', hosts)!;
      fs.mkdirSync(path.join(siteDir, 'img'), { recursive: true });
      const embedded = '@config="mode src=https://example.com/img/a.png rest"';
      fs.writeFileSync(
        path.join(siteDir, indexRel),
        `<!doctype html><html><body><div ${embedded}></div></body></html>`,
      );
      fs.writeFileSync(path.join(siteDir, aRel), 'png-a');

      rewriteMirror({ siteDir, origin: 'https://example.com', manifest });

      expect(fs.readFileSync(path.join(siteDir, indexRel), 'utf8')).toContain(embedded);
    } finally {
      fs.rmSync(siteDir, { recursive: true, force: true });
    }
  });

  it('an unmatched quote inside an HTML comment does not swallow a later genuine unquoted src', async () => {
    const { createMirrorManifest } = await loadMirrorManifest();
    const { localPathForUrl, originHosts, rewriteMirror } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');
    const manifest = createMirrorManifest({ computeLocalPath: localPathForUrl });
    const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-clone-comment-span-'));
    try {
      const indexRel = manifest.claim('https://example.com/', hosts)!;
      const aRel = manifest.claim('https://example.com/img/a.png', hosts)!;
      fs.mkdirSync(path.join(siteDir, 'img'), { recursive: true });
      fs.writeFileSync(
        path.join(siteDir, indexRel),
        '<!doctype html><html><body><!-- config="draft --><img src=https://example.com/img/a.png alt="x"></body></html>',
      );
      fs.writeFileSync(path.join(siteDir, aRel), 'png-a');

      rewriteMirror({ siteDir, origin: 'https://example.com', manifest });

      const html = fs.readFileSync(path.join(siteDir, indexRel), 'utf8');
      // The comment is opaque and byte-identical; the img AFTER it still
      // gets localized instead of being swallowed by a phantom quoted span.
      expect(html).toContain('<!-- config="draft -->');
      expect(html).toMatch(/<img src="\.\/img\/a\.png" alt="x">/);
    } finally {
      fs.rmSync(siteDir, { recursive: true, force: true });
    }
  });
});
