import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Capture-hardening (docket mishmash-docket-1-7): today's designbybrandin.com
// incident shipped a mirror whose capture pass only grabbed the 58 requests a
// single scripted scroll happened to trigger. skills/web-clone/scripts/
// mirror-site.mjs's recursive fetch-missing pass depends on exhaustively
// enumerating every asset the markup/CSS *references*, not just what a
// single browser session requested, so lazy media, hover-state sprites,
// unused @font-face format alternates, and preloaded-but-unrendered assets
// aren't silently dropped. That enumeration is
// skills/web-clone/scripts/lib/asset-discovery.mjs's collectReferenceCandidates
// -- pure text parsing, no fs/network/browser, so it's unit-testable without
// Playwright (which this repo does not install as a workspace dependency;
// see skills/web-clone/SKILL.md's "Open Design environment prep").
// rewrite-mirror.mjs's collectSameOriginRefs (already exported, used by
// mirror-site.mjs's second pass) is refactored to call this same primitive,
// so both are exercised here to confirm the refactor didn't change what a
// mirrored site's on-disk files resolve to.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const discoveryScriptPath = path.join(
  repoRoot,
  'skills',
  'web-clone',
  'scripts',
  'lib',
  'asset-discovery.mjs',
);
const rewriteMirrorScriptPath = path.join(
  repoRoot,
  'skills',
  'web-clone',
  'scripts',
  'rewrite-mirror.mjs',
);

async function loadDiscovery() {
  return (await import(pathToFileURL(discoveryScriptPath).href)) as {
    collectReferenceCandidates: (text: string) => string[];
  };
}

async function loadRewriteMirror() {
  return (await import(pathToFileURL(rewriteMirrorScriptPath).href)) as {
    collectSameOriginRefs: (siteDir: string, hosts: Set<string>, origin?: string) => Set<string>;
    originHosts: (origin: string) => Set<string>;
    localPathForUrl: (url: string, hosts: Set<string>) => string | null;
  };
}

describe('collectReferenceCandidates (pure discovery primitive)', () => {
  it('enumerates every candidate URL inside a srcset attribute', async () => {
    const { collectReferenceCandidates } = await loadDiscovery();
    const html = `<img src="/images/a.jpg" srcset="https://example.com/images/a-1x.jpg 1x, https://example.com/images/a-2x.jpg 2x, /images/a-3x.jpg 3x">`;

    const refs = collectReferenceCandidates(html);

    expect(refs).toContain('https://example.com/images/a-1x.jpg');
    expect(refs).toContain('https://example.com/images/a-2x.jpg');
    expect(refs).toContain('/images/a-3x.jpg');
    // The descriptor (`1x`, `2x`, ...) must not leak into the URL.
    expect(refs.some((ref) => ref.includes(' '))).toBe(false);
  });

  it('enumerates a <source> srcset and a <video poster> the same way', async () => {
    const { collectReferenceCandidates } = await loadDiscovery();
    const html = `<source srcset="/images/b.webp 480w, /images/b-2x.webp 960w"><video poster="https://example.com/images/poster.jpg"></video>`;

    const refs = collectReferenceCandidates(html);

    expect(refs).toContain('/images/b.webp');
    expect(refs).toContain('/images/b-2x.webp');
    expect(refs).toContain('https://example.com/images/poster.jpg');
  });

  it('enumerates an @font-face src url() reference', async () => {
    const { collectReferenceCandidates } = await loadDiscovery();
    const css = `@font-face { font-family: "Foo"; src: url(https://example.com/fonts/Foo.woff2) format("woff2"); }`;

    const refs = collectReferenceCandidates(css);

    expect(refs).toContain('https://example.com/fonts/Foo.woff2');
  });

  it('enumerates a plain CSS url() reference (e.g. a background-image)', async () => {
    const { collectReferenceCandidates } = await loadDiscovery();
    const css = `.hero { background: url('/images/bg.png') no-repeat; }`;

    const refs = collectReferenceCandidates(css);

    expect(refs).toContain('/images/bg.png');
  });

  it('enumerates a <link rel="preload"> href', async () => {
    const { collectReferenceCandidates } = await loadDiscovery();
    const html = `<link rel="preload" as="font" href="https://example.com/fonts/Preload.woff2" crossorigin>`;

    const refs = collectReferenceCandidates(html);

    expect(refs).toContain('https://example.com/fonts/Preload.woff2');
  });

  it('ignores data: URIs and pure fragment refs', async () => {
    const { collectReferenceCandidates } = await loadDiscovery();
    const html = `<img src="data:image/png;base64,iVBORw0KGgo="><a href="#top">Top</a>`;

    const refs = collectReferenceCandidates(html);

    expect(refs).toEqual([]);
  });

  // F21: a data: URI's internal mime/payload-separating comma
  // (`image/svg+xml,%3Csvg...`) is not a srcset candidate separator, and a
  // bare `blob:` reference is not fetchable/reproducible by a mirror pass.
  it('(F21) does not split a data: URI srcset candidate on its internal comma, and ignores blob:', async () => {
    const { collectReferenceCandidates } = await loadDiscovery();
    const html = `<img srcset="data:image/svg+xml,%3Csvg%3E 1x, /ok.png 2x"><video src="blob:https://example.com/9f2c-uuid"></video>`;

    const refs = collectReferenceCandidates(html);

    expect(refs).toContain('/ok.png');
    expect(refs.some((ref) => ref.startsWith('data:'))).toBe(false);
    expect(refs.some((ref) => ref.startsWith('blob:'))).toBe(false);
  });

  // F22: unquoted attribute values are valid HTML5
  // (`<img data-src=/images/lazy.png>`); a quoted-only regex misses them
  // entirely, silently dropping lazy-loaded images from discovery.
  it('(F22) enumerates an unquoted lazy-load attribute value', async () => {
    const { collectReferenceCandidates } = await loadDiscovery();
    const html = `<img data-src=/images/lazy.png class=hero>`;

    const refs = collectReferenceCandidates(html);

    expect(refs).toContain('/images/lazy.png');
  });

  it('(F22) does not double-count a quoted value via the unquoted pattern', async () => {
    const { collectReferenceCandidates } = await loadDiscovery();
    const html = `<img data-src="/images/lazy.png">`;

    const refs = collectReferenceCandidates(html);

    expect(refs.filter((ref) => ref === '/images/lazy.png')).toHaveLength(1);
  });
});

describe('collectSameOriginRefs (rewrite-mirror.mjs, on-disk integration)', () => {
  let siteDir: string;

  beforeEach(() => {
    siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-clone-discovery-'));
  });

  afterEach(() => {
    fs.rmSync(siteDir, { recursive: true, force: true });
  });

  it('discovers srcset variants, @font-face urls, CSS url() refs, and preload hrefs across an HTML file and a CSS file', async () => {
    const { collectSameOriginRefs, originHosts } = await loadRewriteMirror();
    fs.writeFileSync(
      path.join(siteDir, 'index.html'),
      `<!doctype html><html><head>
        <link rel="preload" as="font" href="https://example.com/fonts/Preload.woff2" crossorigin>
      </head><body>
        <img src="/images/a.jpg" srcset="https://example.com/images/a-1x.jpg 1x, https://example.com/images/a-2x.jpg 2x">
        <video poster="https://example.com/images/poster.jpg"></video>
      </body></html>`,
    );
    fs.writeFileSync(
      path.join(siteDir, 'styles.css'),
      `@font-face { font-family: "Foo"; src: url(https://example.com/fonts/Foo.woff2) format("woff2"); }
      .hero { background: url('/images/bg.png'); }`,
    );

    const refs = collectSameOriginRefs(siteDir, originHosts('https://example.com'));

    expect([...refs].sort()).toEqual(
      [
        'fonts/Preload.woff2',
        'images/a-1x.jpg',
        'images/a-2x.jpg',
        'images/a.jpg',
        'images/poster.jpg',
        'fonts/Foo.woff2',
        'images/bg.png',
      ].sort(),
    );
  });

  // F7: a document-relative reference (`../fonts/Foo.woff2`) has no host to
  // check directly -- it must be resolved against the URL the OWNING
  // mirrored file was itself captured from before same-origin filtering can
  // apply. Without `origin`, this class of reference was silently dropped
  // even though it is exactly the kind of "referenced but never requested"
  // asset (an unused @font-face format fallback) the recursive fetch pass
  // exists to catch.
  it('(F7) resolves a document-relative reference against its owning file\'s mirrored path when origin is passed', async () => {
    const { collectSameOriginRefs, originHosts } = await loadRewriteMirror();
    fs.mkdirSync(path.join(siteDir, 'css'), { recursive: true });
    fs.writeFileSync(
      path.join(siteDir, 'css', 'main.css'),
      `@font-face { font-family: "Fallback"; src: url("../fonts/Foo.woff2") format("woff2"); }`,
    );

    const refs = collectSameOriginRefs(siteDir, originHosts('https://example.com'), 'https://example.com');

    expect([...refs]).toContain('fonts/Foo.woff2');
  });

  it('(F7) without an origin, a document-relative reference is not resolved (no guessing)', async () => {
    const { collectSameOriginRefs, originHosts } = await loadRewriteMirror();
    fs.mkdirSync(path.join(siteDir, 'css'), { recursive: true });
    fs.writeFileSync(
      path.join(siteDir, 'css', 'main.css'),
      `@font-face { font-family: "Fallback"; src: url("../fonts/Foo.woff2") format("woff2"); }`,
    );

    const refs = collectSameOriginRefs(siteDir, originHosts('https://example.com'));

    expect([...refs]).not.toContain('fonts/Foo.woff2');
  });

  // Regression caught by a live end-to-end smoke test while hardening F7:
  // `collectReferenceCandidates` matches every attribute value, not a
  // URL-bearing allowlist (charset="utf-8", rel="stylesheet", as="image",
  // height="64", class="hero", ...). Without a guard, the F7 relative-URL
  // resolution branch treated every one of those bare, slash-free words as
  // a "document-relative reference" too (`new URL("utf-8", base)` resolves
  // just fine as a same-directory sibling), turning ordinary HTML attributes
  // into phantom "missing assets" that the recursive fetch pass then 404s
  // on. A genuine relative asset reference always has at least one `/`.
  it('(F7 regression) does not treat ordinary non-URL attribute values as document-relative references', async () => {
    const { collectSameOriginRefs, originHosts } = await loadRewriteMirror();
    fs.writeFileSync(
      path.join(siteDir, 'index.html'),
      `<!doctype html><html><head>
        <meta charset="utf-8">
        <link rel="stylesheet" href="/styles.css">
        <link rel="preload" as="image" href="/images/preload-only.png">
      </head><body>
        <img src="/images/logo.png" width="64" height="64" class="hero">
      </body></html>`,
    );

    const refs = [...collectSameOriginRefs(siteDir, originHosts('https://example.com'), 'https://example.com')];

    expect(refs).not.toContain('utf-8');
    expect(refs).not.toContain('stylesheet');
    expect(refs).not.toContain('preload');
    expect(refs).not.toContain('image');
    expect(refs).not.toContain('64');
    expect(refs).not.toContain('hero');
    // The genuine same-origin references in this fixture must still resolve.
    expect(refs).toContain('styles.css');
    expect(refs).toContain('images/preload-only.png');
    expect(refs).toContain('images/logo.png');
  });
});

describe('localPathForUrl (rewrite-mirror.mjs, F10/F11: unified + query-safe path mapping)', () => {
  // F10: capture (mirror-site.mjs) and rewrite (rewrite-mirror.mjs) used to
  // compute a same URL's local path via two separately-written functions
  // that disagreed on percent-encoding, so the same asset resolved to two
  // different local paths depending on which stage asked. Both now call
  // this single function.
  it('(F10) decodes a percent-encoded pathname consistently', async () => {
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');

    expect(localPathForUrl('https://example.com/models/a%2Fb.buf', hosts)).toBe('models/a/b.buf');
  });

  // F11: two distinct query variants of the same path return two different
  // bodies (`?mode=light` vs `?mode=dark`) -- stripping the query collapsed
  // both onto the same local file, so only whichever was captured first
  // ever got served, silently, for the other variant too.
  it('(F11) distinct query variants of the same path map to distinct local paths', async () => {
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');

    const light = localPathForUrl('https://example.com/theme.css?mode=light', hosts);
    const dark = localPathForUrl('https://example.com/theme.css?mode=dark', hosts);

    expect(light).not.toBeNull();
    expect(dark).not.toBeNull();
    expect(light).not.toBe(dark);
    // Both must still resolve to a `.css` file so the static server's MIME
    // lookup (by extension) keeps working.
    expect(light).toMatch(/\.css$/);
    expect(dark).toMatch(/\.css$/);
  });

  it('(F11) the same URL (same query) always maps to the same local path', async () => {
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');

    const first = localPathForUrl('https://example.com/theme.css?mode=dark', hosts);
    const second = localPathForUrl('https://example.com/theme.css?mode=dark', hosts);

    expect(first).toBe(second);
  });

  it('a query-free URL is unaffected by the query-suffix logic', async () => {
    const { localPathForUrl, originHosts } = await loadRewriteMirror();
    const hosts = originHosts('https://example.com');

    expect(localPathForUrl('https://example.com/theme.css', hosts)).toBe('theme.css');
  });
});
