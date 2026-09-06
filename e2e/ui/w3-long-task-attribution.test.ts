// W3H red spec (PRD 3.6, D-19): opening an HTML artifact whose sibling photos
// are each referenced several times must not block the main thread for over
// a second.
//
// Attribution, from the committed CDP profile (`proof/w3/3H-attribution/`):
// the long task's self time is spent in `apps/web/src/runtime/srcdoc.ts`
// (`injectBeforeHeadEnd`, `annotateMissingOdIds`,
// `annotateManualEditSourcePaths`, `serializeHtmlDocument`) and
// `packages/contracts/src/runtime/body-close-splice.ts` (`scanBodyClose`).
// Every one of those passes is linear in the length of the preview document,
// and that length is decided by `inlineRelativeAssets` in
// `apps/web/src/components/file-viewer-preview-assets.ts`: it substitutes a
// `data:` URL at EVERY occurrence of a confirmed binary asset ref while its
// budget only counts each asset's bytes ONCE. The gallery below shows five
// ~1.4 MiB photos five ways each — a CSS hero background, the full-width
// photo, a rail thumbnail, a lightbox copy, and a grid shot: 7.35 MB of
// distinct binary, which the old accounting charges once and lets through,
// emitting a 49.0 MB document (`proof/w3/3H-attribution/emit-measure.log`).
// On `d3b9bd38b` that blocks the main thread for over 1.8 s in one Long Task
// entry — this spec's own red run, recorded in `proof/w3/3H-red-spec.txt`. The
// exact figure is wall-clock and moves run to run; the emitted-byte figures
// above are deterministic, which is why they are the ones quoted here.
//
// The profiled sibling is a different shape: `gallery6-base-summary.json` is
// six ~1.4 MiB photos at four refs each, 8.82 MB of distinct binary, a 47.0 MB
// emitted document and a 2,595 ms entry. That is the capture the frame list
// above comes from. The two candidates the D-19 audit named ahead of this one
// were both measured and refuted: `blobToDataUrl` costs ~15 ms per MiB (at most
// 127 ms at the 8 MiB per-asset cap) and a 1,200-row unvirtualized file list
// peaked at 293 ms.
//
// The oracle is the browser's own Long Task entries, the same signal the
// `ui-lag` anomaly records (`apps/web/src/observability/long-task.ts`), so a
// green run here is the wave bar's own measurement rather than a proxy for it.
import { deflateSync } from 'node:zlib';

import { expect, test } from '@/playwright/suite';
import { APP_LOADING_TEXT } from '@/playwright/loading';
import { T } from '@/timeouts';
import type { Page } from '@playwright/test';

/** The wave-3 bar (INV-3.10): no `ui-lag` record over this many milliseconds. */
const LONG_TASK_BAR_MS = 1_000;

/**
 * Distinct photos, so nothing dedupes them; each is far under the 8 MiB
 * per-asset cap. There is one section per photo, and five is load-bearing:
 * `htmlLooksMeasurableForCompositionMetrics` routes a document with at least
 * `COMPOSITION_METRICS_SECTION_THRESHOLD` (5) sections through the srcDoc
 * pipeline, and the srcDoc pipeline is where the inlining pass lives. A
 * four-section page URL-loads instead, inlines nothing, and would let this spec
 * pass while measuring a path it never entered.
 */
const PHOTO_COUNT = 5;
/** ~1.4 MiB of incompressible truecolor pixels. */
const PHOTO_SIDE = 700;

declare global {
  interface Window {
    __w3hLongTasks?: Array<{ duration: number; startTime: number }>;
  }
}

test.describe.configure({ timeout: T.xlong * 10 });

test('[P1] opening a gallery artifact keeps every main-thread task under a second', async ({ page }) => {
  await page.request.put('/api/app-config', {
    data: {
      agentId: null,
      agentModels: {},
      designSystemId: null,
      onboardingCompleted: true,
      skillId: null,
    },
  });
  const projectId = await seedGalleryProject(page);

  await page.addInitScript(() => {
    window.__w3hLongTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__w3hLongTasks?.push({ duration: entry.duration, startTime: entry.startTime });
      }
    }).observe({ type: 'longtask' });
    window.localStorage.setItem('mishmash:config', JSON.stringify({
      agentId: null,
      designSystemId: null,
      mode: 'daemon',
      model: 'default',
      onboardingCompleted: true,
      skillId: null,
    }));
  });

  await page.goto(`/projects/${encodeURIComponent(projectId)}`, { waitUntil: 'domcontentloaded' });
  await page.getByText(APP_LOADING_TEXT).first().waitFor({ state: 'hidden', timeout: T.long });
  await expect(page.getByTestId('file-workspace')).toBeVisible({ timeout: T.long });

  // Boot is not the action under test. Drop everything observed up to here so
  // a slow runner's startup work cannot be read as this artifact's cost.
  await page.evaluate(() => { window.__w3hLongTasks = []; });

  await openGalleryPreview(page);

  // Stop as soon as the run has decided itself, either way: the inlining pass
  // landed its document, or the bar is already broken. Waiting only for the
  // inlined document would report a missing element on a run whose real fault
  // is that the pass forfeited its 15 s budget while blocking the main thread.
  const previewFrame = page.frameLocator('[data-testid="artifact-preview-frame"]');
  await expect
    .poll(
      async () => {
        const inlined = await previewFrame.locator('style[data-od-inline-asset]').count();
        const worst = await page.evaluate(() =>
          (window.__w3hLongTasks ?? []).reduce((max, task) => Math.max(max, task.duration), 0));
        return inlined > 0 || worst > LONG_TASK_BAR_MS;
      },
      {
        message: 'the preview neither finished inlining nor blocked the main thread over the bar',
        timeout: T.xlong * 4,
      },
    )
    .toBe(true);
  // A Long Task entry is delivered on a task of its own, AFTER the task it
  // measures ends, and the poll above can exit while the pass still has work in
  // flight. A fixed pause would then read the array before the entry that
  // matters landed. Wait for quiescence instead: no new entry across a full
  // settle window, bounded so a pathological run still reports.
  const quiesceDeadline = Date.now() + T.xlong;
  let seen = -1;
  while (Date.now() < quiesceDeadline) {
    const count = await page.evaluate(() => (window.__w3hLongTasks ?? []).length);
    if (count === seen) break;
    seen = count;
    await page.waitForTimeout(T.medium);
  }

  const longTasks = await page.evaluate(() => window.__w3hLongTasks ?? []);
  const worst = longTasks.reduce((max, task) => Math.max(max, task.duration), 0);
  expect(
    worst,
    `opening the gallery artifact blocked the main thread for ${Math.round(worst)}ms;`
    + ` entries over ${LONG_TASK_BAR_MS}ms: ${JSON.stringify(longTasks.filter((t) => t.duration > LONG_TASK_BAR_MS))}`,
  ).toBeLessThanOrEqual(LONG_TASK_BAR_MS);

  // Guards against a vacuous pass. `data-od-inline-asset` is the marker
  // `inlineRelativeAssets` leaves on every stylesheet it embedded, so it proves
  // the inlined document — not the raw fallback FileViewer substitutes when the
  // pass forfeits its budget — is what is on screen. The photo check is the
  // fidelity half: an asset the budget declines keeps its project URL, and D-11
  // is what makes that URL still decode inside the sandboxed frame.
  await expect(
    previewFrame.locator('style[data-od-inline-asset]').first(),
    'the preview never showed an inlined document, so this run did not exercise the inlining pass',
  ).toBeAttached({ timeout: T.xlong });
  await expect
    .poll(
      async () => previewFrame.locator('img.photo').evaluateAll(
        (nodes) => nodes.filter((node) => (node as HTMLImageElement).naturalWidth > 0).length,
      ),
      { message: 'the gallery preview never decoded every photo', timeout: T.xlong },
    )
    .toBe(PHOTO_COUNT);
  // The stylesheet marker and the decode check above are both satisfied by a
  // preview that inlined no binary asset at all — an over-strict budget, or a
  // regression that switched binary inlining off, would leave a small document,
  // no long task, and every photo decoding from its project URL under D-11. So
  // require at least one photo to have arrived as a `data:` URL: this fixture
  // is sized for the budget to take the first and decline the rest.
  expect(
    await previewFrame.locator('img.photo').evaluateAll(
      (nodes) => nodes.filter((node) => (node as HTMLImageElement).currentSrc.startsWith('data:')).length,
    ),
    'no photo was inlined, so this run measured a preview with binary inlining off rather than a bounded one',
  ).toBeGreaterThan(0);
});

/**
 * A gallery artifact seeded through the production HTTP API: five real PNGs of
 * about 1.4 MiB each, and one section per photo that reaches the same photo
 * five ways — a CSS hero background, the full-width photo, a rail thumbnail, a
 * lightbox copy, and a grid shot. Distinct bytes stay well under the inlining
 * budget; the number of REFS is what decides how large the inlined document
 * becomes.
 *
 * No element may carry `class="slide"`: `sourceLooksLikeDeckPreview` reads that
 * one class as "this document is a deck", and the deck branch of FileViewer's
 * preview effect returns before any asset inlining runs. A fixture that used it
 * would leave this spec measuring a path it never entered.
 */
async function seedGalleryProject(page: Page): Promise<string> {
  const projectId = `w3h-gallery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await page.request.post('/api/projects', {
    data: {
      designSystemId: null,
      id: projectId,
      metadata: { kind: 'prototype' },
      name: 'W3H gallery',
      skillId: null,
    },
  });
  expect(created.ok(), `create project: ${await created.text()}`).toBeTruthy();

  const photos: string[] = [];
  for (let index = 0; index < PHOTO_COUNT; index += 1) {
    const name = `assets/photo-${index + 1}.png`;
    photos.push(name);
    const written = await page.request.post(`/api/projects/${projectId}/files`, {
      data: { content: noisePng(PHOTO_SIDE, 4242 + index * 131).toString('base64'), encoding: 'base64', name },
    });
    expect(written.ok(), `seed ${name}: ${await written.text()}`).toBeTruthy();
  }

  const css = photos
    .map((name, index) => `.hero-${index}{background-image:url("${name.split('/').pop()}");height:320px;background-size:cover}`)
    .join('\n');
  const cssWritten = await page.request.post(`/api/projects/${projectId}/files`, {
    data: { content: css, name: 'assets/gallery.css' },
  });
  expect(cssWritten.ok(), `seed gallery.css: ${await cssWritten.text()}`).toBeTruthy();

  const sections = photos.map((photo, index) => `<section id="s${index}"><h2>Photo ${index + 1}</h2>`
    + `<div class="hero-${index}"></div>`
    + `<img class="photo" src="${photo}" alt="" width="960">`
    + `<img class="rail" src="${photo}" alt="" width="120">`
    + `<img class="lightbox" src="${photo}" alt="" width="1440">`
    + `<img class="shot" src="${photo}" alt="" width="320">`
    + `<p>${'gallery caption copy. '.repeat(60)}</p></section>`).join('\n');
  const htmlWritten = await page.request.post(`/api/projects/${projectId}/files`, {
    data: {
      content: '<!doctype html>\n<html><head><meta charset="utf-8"><title>W3H gallery</title>\n'
        + '<link rel="stylesheet" href="assets/gallery.css">\n</head><body>\n'
        + `${sections}\n</body></html>\n`,
      name: 'index.html',
    },
  });
  expect(htmlWritten.ok(), `seed index.html: ${await htmlWritten.text()}`).toBeTruthy();
  return projectId;
}

/**
 * Open the gallery the way a reader does: the workspace Pages menu, then the page.
 *
 * Deliberately NOT through "All project files". That panel mounts a preview
 * iframe per file row, each of which loads this gallery's photos from their raw
 * URLs; the origin's connection pool is then busy for minutes and the inlining
 * pass's own fetches never get a turn, so the run measures connection
 * starvation (D-21) instead of the path this spec is about.
 */
async function openGalleryPreview(page: Page): Promise<void> {
  await page.getByTestId('workspace-pages-menu-trigger').click();
  const menu = page.getByTestId('workspace-pages-menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: /^index$/i }).click();
  await expect(page.getByTestId('artifact-preview-frame')).toBeAttached({ timeout: T.long });
}

/**
 * A real, incompressible PNG. Pseudo-random truecolor pixels keep deflate from
 * shrinking it, so the seeded file is genuinely the size the fixture needs
 * rather than a few kilobytes that happen to declare large dimensions.
 */
function noisePng(side: number, seed: number): Buffer {
  const raw = Buffer.alloc(side * (side * 3 + 1));
  let state = seed >>> 0;
  for (let y = 0; y < side; y += 1) {
    const rowStart = y * (side * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < side * 3; x += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      raw[rowStart + 1 + x] = (state >>> 24) & 0xff;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(side, 0);
  header.writeUInt32BE(side, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 1 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) c = (CRC_TABLE[(c ^ buffer[i]!) & 0xff] as number) ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
