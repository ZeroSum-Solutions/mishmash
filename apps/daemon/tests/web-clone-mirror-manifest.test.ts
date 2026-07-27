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
//     sourceUrl<->localPath source of truth, injective by construction (a
//     colliding "natural" path gets disambiguated with a hash of the raw
//     url rather than letting a second write silently reuse the first
//     write's file), plus findMissingSourceUrls/isCaptured, which return
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
