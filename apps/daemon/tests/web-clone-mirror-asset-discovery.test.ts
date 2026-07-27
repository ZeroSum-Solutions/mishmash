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
    collectSameOriginRefs: (siteDir: string, hosts: Set<string>) => Set<string>;
    originHosts: (origin: string) => Set<string>;
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
});
