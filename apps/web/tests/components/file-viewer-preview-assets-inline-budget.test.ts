import { describe, expect, it } from 'vitest';

import { inlineRelativeAssets } from '../../src/components/file-viewer-preview-assets';

// W3H red spec (PRD 3.6, D-19).
//
// The canvas preview inlines every confirmed binary project asset as a `data:`
// URL so it resolves inside the opaque-origin srcdoc frame
// (`file-viewer-binary-asset-inlining.test.ts` documents why). The pass is
// bounded by `BINARY_ASSET_TOTAL_BUDGET_BYTES`, and the bound is what keeps the
// document short enough for the passes that run after it — `buildSrcdoc`'s
// annotate/serialize walks and `scanBodyClose` are each linear in its length.
//
// The defect: the budget charged each asset its FILE SIZE, once, while
// `inlineBinaryAssetRefs` substitutes the asset's `data:` URL at EVERY
// confirmed reference. A photo referenced six times was therefore written into
// the document six times against a single charge. Profiled on `d3b9bd38b`
// against a real tools-dev runtime (`proof/w3/3H-attribution/`,
// `gallery6-base-summary.json`): six 1.4 MiB photos referenced four ways each —
// 8.82 MB of distinct binary, well inside the 16 MiB budget as the old
// accounting counted it — emitted a 47.0 MB document and blocked the main
// thread for 2,595 ms in one Long Task, the `ui-lag` band the wave bar caps at
// 1,000 ms.
//
// The fixtures below use images only, no stylesheet or script, so everything
// the pass adds to the document is binary-asset bytes and the growth of the
// returned string is exactly what the budget is supposed to bound.

/**
 * The module's own `BINARY_ASSET_TOTAL_BUDGET_BYTES`, restated here rather than
 * imported: this spec has to fail on the unfixed module, and a missing export
 * would fail it for the wrong reason.
 */
const INLINE_BUDGET_BYTES = 16 * 1024 * 1024;

/** Distinct bytes, so nothing dedupes and the response is genuinely this large. */
function noiseBytes(size: number, seed: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(size));
  let state = seed >>> 0;
  for (let index = 0; index < size; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[index] = (state >>> 24) & 0xff;
  }
  return bytes;
}

const rawUrl = (projectId: string, filePath: string) =>
  `http://preview.test/api/projects/${projectId}/raw/${filePath}`;

function readerFor(assets: ReadonlyMap<string, Uint8Array<ArrayBuffer>>): typeof globalThis.fetch {
  return async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    for (const [path, bytes] of assets) {
      if (url === rawUrl('p1', path)) {
        return new Response(bytes, { headers: { 'content-type': 'image/png' } });
      }
    }
    return new Response('missing fixture', { status: 404 });
  };
}

/** One photo, reached `refs` ways: a preload link, then `refs - 1` `<img>` tags. */
function galleryHtml(assetPath: string, refs: number): string {
  const images = Array.from(
    { length: refs - 1 },
    (_unused, index) => `<img class="shot-${index}" src="${assetPath}" alt="">`,
  ).join('');
  return `<!doctype html><html><head><link rel="preload" as="image" href="${assetPath}">`
    + `</head><body>${images}</body></html>`;
}

describe('inlineRelativeAssets — the inlining budget bounds emitted bytes', () => {
  const projectFilePaths = new Set(['index.html', 'assets/photo.png']);

  it('leaves an asset at its raw url when its copies would not fit the budget', async () => {
    // 3 MiB of photo written six times is ~24 MiB of base64 — half again the
    // 16 MiB budget, from an asset the old accounting charged 3 MiB for.
    const photo = noiseBytes(3 * 1024 * 1024, 20260905);
    const html = galleryHtml('assets/photo.png', 6);

    const inlined = await inlineRelativeAssets(html, 'p1', 'index.html', projectFilePaths, {
      fetch: readerFor(new Map([['assets/photo.png', photo]])),
      rawUrl,
    });

    expect(
      inlined.length - html.length,
      'the inlining pass wrote more into the preview document than its budget allows',
    ).toBeLessThanOrEqual(INLINE_BUDGET_BYTES);
    // Declining is not blanking: an asset the budget turns down keeps the
    // project ref it arrived with, which is what the URL-load preview path and
    // the raw-asset fallback still render from.
    expect(inlined).toContain('src="assets/photo.png"');
    expect(inlined).not.toContain('data:image/png;base64,');
  });

  it('still inlines an asset whose copies fit, at every reference', async () => {
    // 1 MiB written three times is ~4 MiB of base64, comfortably inside the
    // budget: bounding the emitted total must not switch the feature off.
    const photo = noiseBytes(1024 * 1024, 4242);
    const html = galleryHtml('assets/photo.png', 3);

    const inlined = await inlineRelativeAssets(html, 'p1', 'index.html', projectFilePaths, {
      fetch: readerFor(new Map([['assets/photo.png', photo]])),
      rawUrl,
    });

    expect(inlined.split('data:image/png;base64,').length - 1).toBe(3);
    expect(inlined).not.toContain('"assets/photo.png"');
    expect(inlined.length - html.length).toBeLessThanOrEqual(INLINE_BUDGET_BYTES);
  });
});
