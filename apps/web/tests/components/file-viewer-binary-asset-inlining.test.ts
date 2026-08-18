import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import * as previewAssets from '../../src/components/file-viewer-preview-assets';
import {
  collectBinaryPreviewAssetPaths,
  inlineBinaryAssetRefs,
  isBinaryPreviewAssetPath,
  rewriteInlinedCssAssetRefs,
} from '../../src/components/file-viewer-preview-assets';

type InlineRelativeAssets = (
  html: string,
  projectId: string,
  fileName: string,
  projectFilePaths: ReadonlySet<string> | null,
  access: {
    fetch: typeof globalThis.fetch;
    rawUrl: (projectId: string, filePath: string) => string;
  },
) => Promise<string>;

// WHY THIS EXISTS
//
// The canvas renders a project preview in `<iframe sandbox="allow-scripts
// allow-downloads" srcdoc="...">`. Without `allow-same-origin` that document
// has an OPAQUE origin, and a document with an opaque origin cannot load ANY
// subresource from the daemon — measured 2026-08-17 in the real app, 9s
// window, only the sandbox attribute varied:
//
//   sandbox="allow-scripts allow-downloads"              img FAIL  video stalled(readyState 0)  script FAIL  css FAIL
//   sandbox="... allow-same-origin"                      img OK    video canplay(readyState 4)  script OK    css OK
//
// Ruled out by experiment, so do not "fix" this by revisiting them: autoplay
// policy (adding allow="autoplay" changed nothing), CSP (reproduced from a
// parent page serving no CSP at all), URL resolution (the failing frame
// reported the correct absolute currentSrc), and server rejection (curl with
// Origin: null and every Sec-Fetch-Dest returns 200).
//
// Text assets already dodge this: `inlineRelativeAssets` fetches stylesheets
// and scripts in the PARENT (same-origin, works) and inlines them. That is why
// vite-shaped templates render and `ember-dsgn-hero` — 1MB assets/hero-bg.mp4 +
// 50KB poster — renders as a black page. Binary assets are neither inlined nor
// reachable.
//
// `data:` URLs need no network request at all, so they load in an opaque
// origin. Measured in the same production sandbox:
//   data: img -> naturalWidth 1280, video -> readyState 4, videoWidth 1280   OK
//   blob: img -> FAIL, video -> readyState 0   (blob URLs are keyed to the
//                                               creating origin)
// Both `img-src` and `media-src` already list `data:` in projectRawFileCsp, so
// this needs no CSP change and no sandbox change — it keeps the strongest
// isolation the preview has.

describe('isBinaryPreviewAssetPath', () => {
  it('recognises the media types that cannot be inlined as text', () => {
    for (const path of [
      'assets/hero-bg.mp4',
      'assets/hero-poster.jpg',
      'img/a.PNG',
      'media/clip.webm',
      'audio/theme.mp3',
      'fonts/Inter.woff2',
      'fonts/legacy.ttf',
      'img/photo.avif',
    ]) {
      expect(isBinaryPreviewAssetPath(path), path).toBe(true);
    }
  });

  it('leaves text assets to the existing stylesheet/script inlining', () => {
    for (const path of ['main.css', 'assets/index-DsWXwE4C.js', 'index.html', 'data.json']) {
      expect(isBinaryPreviewAssetPath(path), path).toBe(false);
    }
  });

  // SVG is deliberately text but is still fetched as a subresource by <img
  // src>, so it fails in the opaque origin exactly like a PNG does.
  it('treats svg as inlinable, because <img src> fetches it as a subresource', () => {
    expect(isBinaryPreviewAssetPath('icon/logo.svg')).toBe(true);
  });
});

describe('collectBinaryPreviewAssetPaths', () => {
  const files = new Set([
    'assets/hero-bg.mp4',
    'assets/hero-poster.jpg',
    'assets/index-DsWXwE4C.js',
    'main.css',
    'img/wide.png',
    'img/narrow.png',
  ]);

  it("collects ember's video, its <source>, and its poster", () => {
    const html = `
      <video class="bg-video" autoplay muted loop playsinline poster="assets/hero-poster.jpg">
        <source src="assets/hero-bg.mp4" type="video/mp4">
      </video>
      <img src="assets/hero-poster.jpg" alt="">`;
    const paths = collectBinaryPreviewAssetPaths(html, 'example.html', files);
    expect(new Set(paths)).toEqual(new Set(['assets/hero-bg.mp4', 'assets/hero-poster.jpg']));
  });

  it('does not collect scripts or stylesheets — those are already inlined as text', () => {
    const html =
      '<link rel="stylesheet" href="main.css"><script src="assets/index-DsWXwE4C.js"></script>';
    expect(collectBinaryPreviewAssetPaths(html, 'example.html', files)).toEqual([]);
  });

  it('collects every candidate in a srcset', () => {
    const html = '<img srcset="img/narrow.png 600w, img/wide.png 1200w" src="img/wide.png">';
    expect(new Set(collectBinaryPreviewAssetPaths(html, 'example.html', files))).toEqual(
      new Set(['img/narrow.png', 'img/wide.png']),
    );
  });

  it('collects css url() refs from inline <style> and style attributes', () => {
    const html =
      '<style>.hero{background:url("img/wide.png")}</style><div style="background:url(img/narrow.png)"></div>';
    expect(new Set(collectBinaryPreviewAssetPaths(html, 'example.html', files))).toEqual(
      new Set(['img/wide.png', 'img/narrow.png']),
    );
  });

  it('ignores refs that are not real project files, and external/data refs', () => {
    const html = `
      <img src="assets/missing.png">
      <img src="https://cdn.example.com/x.png">
      <img src="data:image/gif;base64,R0lGOD">`;
    expect(collectBinaryPreviewAssetPaths(html, 'example.html', files)).toEqual([]);
  });

  it('resolves refs against the owner file directory, not the project root', () => {
    const nested = new Set(['zh/img/logo.png']);
    const html = '<img src="img/logo.png">';
    expect(collectBinaryPreviewAssetPaths(html, 'zh/index.html', nested)).toEqual(['zh/img/logo.png']);
  });
});

describe('inlineBinaryAssetRefs', () => {
  const files = new Set([
    'assets/hero-bg.mp4',
    'assets/hero-poster.jpg',
    'img/narrow.png',
    'img/wide.png',
  ]);
  const dataUrls = new Map([
    ['assets/hero-bg.mp4', 'data:video/mp4;base64,AAAAvideo'],
    ['assets/hero-poster.jpg', 'data:image/jpeg;base64,AAAAposter'],
  ]);

  it("makes ember's video and poster render in an opaque-origin frame", () => {
    const html =
      '<video poster="assets/hero-poster.jpg"><source src="assets/hero-bg.mp4" type="video/mp4"></video>';
    const out = inlineBinaryAssetRefs(html, 'example.html', files, dataUrls);
    expect(out).toContain('poster="data:image/jpeg;base64,AAAAposter"');
    expect(out).toContain('src="data:video/mp4;base64,AAAAvideo"');
    expect(out).not.toContain('assets/hero-bg.mp4');
  });

  it('rewrites css url() refs inside inline styles', () => {
    const html = '<style>.hero{background:url("assets/hero-poster.jpg")}</style>';
    expect(inlineBinaryAssetRefs(html, 'example.html', files, dataUrls)).toContain(
      'url("data:image/jpeg;base64,AAAAposter")',
    );
  });

  it('collapses an inlined multi-candidate srcset to one valid image source', () => {
    const narrow = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    const wide = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAAB';
    const html = '<img alt="hero" srcset="img/narrow.png 600w, img/wide.png 1200w">';
    const out = inlineBinaryAssetRefs(
      html,
      'example.html',
      files,
      new Map([
        ['img/narrow.png', narrow],
        ['img/wide.png', wide],
      ]),
    );

    const image = new JSDOM(out).window.document.querySelector('img');
    expect(image?.getAttribute('src')).toBe(narrow);
    expect(image?.hasAttribute('srcset')).toBe(false);
    expect(out.match(/data:image\/png;base64,/g)).toHaveLength(1);
  });

  // The budget case. A template whose media exceeds the cap must degrade to
  // exactly today's behaviour for that one asset, not throw and not blank the
  // whole document.
  it('leaves an asset untouched when no data url was supplied (over budget)', () => {
    const html = '<img src="img/wide.png"><img src="assets/hero-poster.jpg">';
    const out = inlineBinaryAssetRefs(html, 'example.html', files, dataUrls);
    expect(out).toContain('src="img/wide.png"');
    expect(out).toContain('src="data:image/jpeg;base64,AAAAposter"');
  });

  it('leaves external and already-inline refs alone', () => {
    const html =
      '<img src="https://cdn.example.com/x.png"><img src="data:image/gif;base64,R0lGOD">';
    expect(inlineBinaryAssetRefs(html, 'example.html', files, dataUrls)).toBe(html);
  });

  it('is a no-op when nothing was resolved', () => {
    const html = '<img src="assets/hero-poster.jpg">';
    expect(inlineBinaryAssetRefs(html, 'example.html', files, new Map())).toBe(html);
  });
});

describe('rewriteInlinedCssAssetRefs — data urls for binary refs', () => {
  const files = new Set(['fonts/Inter.woff2', 'img/bg.png', 'nested/other.css']);
  const toRawUrl = (path: string) => `/api/projects/p1/raw/${path}`;

  // A stylesheet that gets inlined has its url() refs rewritten to ABSOLUTE raw
  // URLs today. In the opaque frame those absolute URLs fail exactly like
  // relative ones did — the failing probe resolved the correct absolute URL and
  // still could not load it. So a font referenced from an inlined stylesheet is
  // broken for the same reason the video is.
  it('prefers a data url over the raw url when one is available', () => {
    const dataUrls = new Map([['fonts/Inter.woff2', 'data:font/woff2;base64,AAAAfont']]);
    const css = "@font-face{font-family:Inter;src:url('fonts/Inter.woff2') format('woff2')}";
    const out = rewriteInlinedCssAssetRefs(css, 'main.css', files, toRawUrl, dataUrls);
    expect(out).toContain('data:font/woff2;base64,AAAAfont');
    expect(out).not.toContain('/api/projects/p1/raw/fonts/Inter.woff2');
  });

  it('falls back to the raw url when the asset was over budget', () => {
    const css = '.hero{background:url(img/bg.png)}';
    const out = rewriteInlinedCssAssetRefs(css, 'main.css', files, toRawUrl, new Map());
    expect(out).toContain('/api/projects/p1/raw/img/bg.png');
  });

  // Guards the existing callers, which pass no data-url map at all.
  it('behaves exactly as before when no data url map is supplied', () => {
    const css = '.hero{background:url(img/bg.png)}';
    expect(rewriteInlinedCssAssetRefs(css, 'main.css', files, toRawUrl)).toContain(
      '/api/projects/p1/raw/img/bg.png',
    );
  });
});

describe('inlineRelativeAssets', () => {
  it('derives data-url MIME from the asset extension instead of hostile response metadata', async () => {
    const rawUrl = (_projectId: string, filePath: string) => `http://preview.test/raw/${filePath}`;
    const hostileType = 'image/png;payload="breakout)"';
    const fetchFixture: typeof globalThis.fetch = async () =>
      new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { 'content-type': hostileType },
      });

    const inlined = await previewAssets.inlineRelativeAssets(
      '<img src="assets/logo.png">',
      'project-1',
      'index.html',
      new Set(['index.html', 'assets/logo.png']),
      { fetch: fetchFixture, rawUrl },
    );

    expect(inlined).toContain('src="data:image/png;base64,iVBORw=="');
    expect(inlined).not.toContain('payload');
  });

  it('runs the complete parent-side text and binary inlining pipeline through one shared export', async () => {
    const inlineRelativeAssets = (
      previewAssets as typeof previewAssets & { inlineRelativeAssets?: InlineRelativeAssets }
    ).inlineRelativeAssets;
    expect(typeof inlineRelativeAssets).toBe('function');
    if (!inlineRelativeAssets) return;

    const origin = 'http://127.0.0.1:59920';
    const rawUrl = (projectId: string, filePath: string) =>
      `${origin}/api/projects/${encodeURIComponent(projectId)}/raw/${filePath
        .split('/')
        .map((part) => encodeURIComponent(part))
        .join('/')}`;
    const responses = new Map<string, Response>([
      [
        rawUrl('project 1', 'fonts/fonts.css'),
        new Response("@font-face{font-family:Local;src:url('./local.woff2')}", {
          headers: { 'content-type': 'text/css' },
        }),
      ],
      [
        rawUrl('project 1', 'assets/app.js'),
        new Response('window.__previewLoaded = true;', {
          headers: { 'content-type': 'text/javascript' },
        }),
      ],
      [
        rawUrl('project 1', 'fonts/local.woff2'),
        new Response(new Uint8Array([0, 1, 2, 3]), {
          headers: { 'content-type': 'font/woff2' },
        }),
      ],
      [
        rawUrl('project 1', 'assets/logo.png'),
        new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { 'content-type': 'image/png' },
        }),
      ],
    ]);
    const fetchFixture: typeof globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const response = responses.get(url);
      return response?.clone() ?? new Response('missing fixture', { status: 404 });
    };
    const html = [
      '<!doctype html><html><head>',
      '<link rel="stylesheet" href="../fonts/fonts.css">',
      '</head><body>',
      '<img src="../assets/logo.png">',
      '<script src="../assets/app.js"></script>',
      '</body></html>',
    ].join('');

    const inlined = await inlineRelativeAssets(
      html,
      'project 1',
      'pages/index.html',
      new Set([
        'pages/index.html',
        'fonts/fonts.css',
        'fonts/local.woff2',
        'assets/logo.png',
        'assets/app.js',
      ]),
      { fetch: fetchFixture, rawUrl },
    );

    expect(inlined).toContain('<style data-od-inline-asset="../fonts/fonts.css">');
    expect(inlined).toContain('window.__previewLoaded = true;');
    expect(inlined).toContain('data:font/woff2;base64,AAECAw==');
    expect(inlined).toContain('data:image/png;base64,iVBORw==');
    expect(inlined).not.toContain('<script src="../assets/app.js"></script>');
  });
});
