// W2H.1b red spec — D-17 landing condition 2. What `painted: true` is allowed
// to mean.
//
// The producer decided paint with `hasArea()`: one laid-out box with non-zero
// width and height anywhere under `<body>`. Its own docblock admitted the
// false-positive class — "geometry without pixels: a laid-out box that is
// transparent, `visibility: hidden`, `opacity: 0`, or scrolled out of view" —
// and the host settles unconditionally on `painted: true`. So a preview the
// user sees as blank reports itself healthy, which is exactly the
// zero-visible-output half of Codex F1.
//
// GPT-5.6 round 1: "`painted` means geometry, not visible output ... That
// contradicts 'never settle on zero visible output.'" Round 2 set the rule:
// prefer same-document Paint Timing when the nested context exposes it, else a
// bounded lazy scan that clips against the viewport and every ancestor
// scrollport, requires an opacity product above zero, counts only direct text
// nodes and real paint sources, and never treats blank replaced geometry
// (canvas, svg, iframe) as output.
//
// A real browser is the only place this can be judged: jsdom reports every
// rect as 0x0 and has no `getComputedStyle` cascade to speak of, so the
// predicate would be tested against a fiction. The cases below run the SHIPPED
// producer source — the same string every transport embeds — in Chromium,
// against real layout.
//
// W2H.1d — D-17 dialogue round 4 added the transparent-output blocker: a
// visible box whose only paint source was `linear-gradient(transparent,
// transparent)` reported `painted: true`, and so did a fully transparent
// image. The gradient half is decided here, against Chromium's computed
// values. The image half cannot be: Chromium fires a contentful paint for any
// decoded image, transparent or not, so Paint Timing — asked first, and
// deliberately so — answers before the scan's image rules are reached. What
// this file pins for the image half is therefore the two BROWSER facts those
// rules rest on (which images a canvas may read, and that a transparent image
// still fires a contentful paint); the decision itself is pinned where Paint
// Timing is silent, in `packages/contracts/tests/preview-paint-transparent.
// test.ts`.

import { PREVIEW_PAINT_REPORT_PRODUCER_SOURCE } from '@open-design/contracts/runtime/preview-paint-report';
import type { Page } from '@playwright/test';

import { expect, test } from '@/playwright/suite';
import { T } from '@/timeouts';

const REPORT = 'od:preview-content-size';

interface PaintReport {
  painted?: unknown;
  reason?: unknown;
  evidence?: unknown;
  scanTruncated?: unknown;
  counters?: { seen?: unknown; hidden?: unknown; clipped?: unknown; blank?: unknown };
  width?: unknown;
}

test.describe.configure({ timeout: T.long });

/**
 * Runs the shipped producer against a real document and returns the report it
 * makes about that document. The producer posts to `window.parent`; a top-level
 * page is its own parent, so the report is observable without a frame.
 */
async function reportFor(page: Page, body: string, head = ''): Promise<PaintReport> {
  await page.goto('about:blank');
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`,
  );
  await page.addScriptTag({ content: PREVIEW_PAINT_REPORT_PRODUCER_SOURCE });
  // Let layout, decoding and any paint-timing entry settle before asking.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 60)));
      }),
  );
  return page.evaluate(
    (reportType: string) =>
      new Promise<PaintReport>((resolve) => {
        window.addEventListener('message', (event: MessageEvent) => {
          const data = event.data as { type?: string } | null;
          if (data?.type === reportType) resolve(data as PaintReport);
        });
        (window as unknown as { __odPreviewPaintReport: { post: () => void } }).__odPreviewPaintReport.post();
      }),
    REPORT,
  );
}

/** A 2x2 opaque red PNG, so `img` cases have real decoded intrinsic size. */
const RED_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==';

/** A 2x2 PNG whose every pixel has zero alpha: decoded, intrinsically sized, invisible. */
const TRANSPARENT_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII=';

/**
 * A host no DNS resolves (`.test` is reserved by RFC 2606) that the test
 * fulfils itself, so an image can be genuinely cross-origin to the document
 * without a second server. A response with no `Access-Control-Allow-Origin`
 * taints the canvas it is drawn into, which is what makes its pixels
 * unreadable.
 */
const CROSS_ORIGIN_IMAGE = 'https://cross-origin.mishmash.test/pixel.png';

test('[P1] a document whose only content is invisible does not report itself painted', async ({ page }) => {
  const hidden = await reportFor(page, '<div style="visibility:hidden"><h1>Hidden</h1></div>');
  expect(hidden.painted, 'visibility:hidden geometry is not visible output').toBe(false);
  expect(hidden.reason).toBe('no-visible-output');

  const transparent = await reportFor(page, '<h1 style="opacity:0">Transparent</h1>');
  expect(transparent.painted, 'an opacity product of zero is not visible output').toBe(false);

  const clipped = await reportFor(
    page,
    '<div style="width:0;height:0;overflow:hidden"><h1>Clipped</h1></div>',
  );
  expect(clipped.painted, 'content clipped away by an ancestor scrollport is not visible output').toBe(false);

  const offscreen = await reportFor(
    page,
    '<h1 style="position:absolute;left:-9999px;top:0">Offscreen</h1>',
  );
  expect(offscreen.painted, 'content laid out outside the viewport is not visible output').toBe(false);

  // W2H.1c: the same offscreen text, this time behind an `overflow:hidden`
  // ancestor. The ancestor's clip intersects the viewport to NOTHING, which is
  // the opposite of "no clip at all" — and reading the empty intersection as
  // unbounded let a document nobody can see report itself painted.
  const clippedAway = await reportFor(
    page,
    '<div style="position:absolute;left:-9999px;top:0;width:200px;height:100px;overflow:hidden">' +
      '<h1>Clipped away</h1></div>',
  );
  expect(
    clippedAway.painted,
    'an empty clipping intersection hides everything inside it; it does not stop clipping',
  ).toBe(false);
  expect(clippedAway.reason).toBe('no-visible-output');
});

test('[P1] blank replaced geometry is not visible output, drawn content is', async ({ page }) => {
  const blankCanvas = await reportFor(page, '<canvas width="200" height="100"></canvas>');
  expect(
    blankCanvas.painted,
    'a canvas nobody drew on is a blank rectangle, and its geometry must not settle the watchdog',
  ).toBe(false);

  const blankSvg = await reportFor(page, '<svg width="200" height="100"></svg>');
  expect(blankSvg.painted, 'an svg with no painted children is a blank rectangle').toBe(false);

  // W2H.1c: the third member of the same family, asked for by D-17 round 3.
  // The border is switched off deliberately — a UA-default iframe border is
  // real ink, and this case is about the blank rectangle, not about the frame.
  const blankIframe = await reportFor(
    page,
    '<iframe style="width:200px;height:100px;border:0"></iframe>',
  );
  expect(
    blankIframe.painted,
    'an iframe the scan cannot see into is a blank rectangle, and its geometry must not settle the watchdog',
  ).toBe(false);

  const drawn = await reportFor(
    page,
    '<canvas id="c" width="200" height="100"></canvas>' +
      '<script>var x=document.getElementById("c").getContext("2d");x.fillStyle="#f00";x.fillRect(0,0,200,100);</script>',
  );
  expect(drawn.painted, 'a canvas that was drawn on is visible output').toBe(true);
});

test('[P1] real paint sources are visible output', async ({ page }) => {
  const text = await reportFor(page, '<h1>Visible artifact</h1>');
  expect(text.painted, 'a direct text node with an opaque colour paints').toBe(true);

  const background = await reportFor(
    page,
    '<div style="width:120px;height:80px;background:#ef4444"></div>',
  );
  expect(background.painted, 'an opaque background paints').toBe(true);

  const border = await reportFor(
    page,
    '<div style="width:120px;height:80px;border:2px solid #2563eb"></div>',
  );
  expect(border.painted, 'a visible border paints').toBe(true);

  const image = await reportFor(page, `<img src="${RED_PNG}" style="width:60px;height:60px">`);
  expect(image.painted, 'a decoded image with intrinsic size paints').toBe(true);

  const svg = await reportFor(
    page,
    '<svg width="80" height="80"><circle cx="40" cy="40" r="30" fill="#16a34a"></circle></svg>',
  );
  expect(svg.painted, 'an svg shape with a fill paints').toBe(true);

  const shadow = await reportFor(
    page,
    '<div style="width:120px;height:80px;box-shadow:0 0 12px 6px #111"></div>',
  );
  expect(shadow.painted, 'a box-shadow is ink outside an otherwise empty box').toBe(true);

  const outline = await reportFor(
    page,
    '<div style="width:120px;height:80px;outline:3px solid #111"></div>',
  );
  expect(outline.painted, 'an outline is ink the border properties do not carry').toBe(true);
});

test('[P1] a paint source with no pixels is not visible output', async ({ page }) => {
  // D-17 round 4, executed against the shipped producer: "a visible box whose
  // sole paint source was `linear-gradient(transparent, transparent)` returned
  // `painted:true`". Chromium fires no contentful paint for a gradient — it is
  // not an image resource — so the scan is what answers, and the scan has to
  // read the stops.
  const transparentGradient = await reportFor(
    page,
    '<div style="width:200px;height:120px;background-image:linear-gradient(transparent, transparent)"></div>',
  );
  expect(
    transparentGradient.painted,
    'a gradient every stop of which is transparent paints nothing a user can see',
  ).toBe(false);
  expect(transparentGradient.reason).toBe('no-visible-output');

  const fadedGradient = await reportFor(
    page,
    '<div style="width:200px;height:120px;background-image:linear-gradient(#2563eb, transparent)"></div>',
  );
  expect(
    fadedGradient.painted,
    'a gradient that fades to nothing still inks the end it starts from',
  ).toBe(true);
  expect(fadedGradient.reason).toBe('painted');
});

test('[P1] which image pixels a preview document may read', async ({ page }) => {
  // The two browser facts the image half of the rule rests on, kept in the
  // repo rather than in a run log, in the same spirit as the contentful-paint
  // measurement below. An image the document is allowed to read leaves the
  // canvas untainted and its alpha channel readable — a `data:` URL is such an
  // image, which is why an artifact that inlines its images can be decided at
  // all; a cross-origin one taints the canvas and cannot be read. The producer
  // samples the first and reports the second as `evidence: 'image-unverified'`
  // rather than guessing.
  await page.route(CROSS_ORIGIN_IMAGE, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(RED_PNG.split(',')[1]!, 'base64'),
    }),
  );

  const alphaOf = async (src: string): Promise<{ readable: boolean; maxAlpha: number; error: string }> => {
    await page.goto('about:blank');
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"></head><body><img id="probe" src="${src}"></body></html>`,
    );
    await page.waitForFunction(() => {
      const img = document.getElementById('probe') as HTMLImageElement | null;
      return img !== null && img.complete && img.naturalWidth > 0;
    });
    return page.evaluate(() => {
      const img = document.getElementById('probe') as HTMLImageElement;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const context = canvas.getContext('2d')!;
        context.drawImage(img, 0, 0, 16, 16);
        const pixels = context.getImageData(0, 0, 16, 16).data;
        let maxAlpha = 0;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index]! > maxAlpha) maxAlpha = pixels[index]!;
        }
        return { readable: true, maxAlpha, error: '' };
      } catch (error) {
        return { readable: false, maxAlpha: -1, error: (error as Error).name };
      }
    });
  };

  const transparent = await alphaOf(TRANSPARENT_PNG);
  expect(transparent.readable, 'a `data:` URL image does not taint the canvas').toBe(true);
  expect(transparent.maxAlpha, 'every pixel of this PNG is fully transparent').toBe(0);

  const opaque = await alphaOf(RED_PNG);
  expect(opaque.readable).toBe(true);
  expect(opaque.maxAlpha, 'an opaque image reads back opaque').toBeGreaterThan(0);

  const crossOrigin = await alphaOf(CROSS_ORIGIN_IMAGE);
  expect(
    crossOrigin.readable,
    'a cross-origin image taints the canvas, so its pixels are not decidable — in the ' +
      'sandboxed opaque-origin preview frame that is every http(s) image',
  ).toBe(false);
  expect(crossOrigin.error).toBe('SecurityError');

  // And what the SHIPPED producer reports for the same two documents in this
  // browser, so the end of the chain is stated rather than inferred. Both come
  // back painted through Paint Timing, not through the image rules: Chromium
  // reports a contentful paint for a decoded image whether or not it has
  // visible pixels (measured in the case below), and Paint Timing is asked
  // first by design. The image rules — sample the alpha where a canvas may read
  // it, report `evidence: 'image-unverified'` where it may not — therefore
  // decide only where a user agent exposes no paint timing for a nested
  // browsing context, and they are judged there, in
  // `packages/contracts/tests/preview-paint-transparent.test.ts`. This case
  // exists so a future Chromium that stops reporting a contentful paint for a
  // transparent image is noticed HERE rather than in a user's blank preview.
  const transparentReport = await reportFor(
    page,
    `<img src="${TRANSPARENT_PNG}" style="width:60px;height:60px">`,
  );
  expect(transparentReport.painted).toBe(true);
  expect(
    transparentReport.reason,
    'the user agent answered for this document; the scan never reached the image',
  ).toBe('paint-timing');

  const crossOriginReport = await reportFor(
    page,
    `<img src="${CROSS_ORIGIN_IMAGE}" style="width:60px;height:60px">`,
  );
  expect(crossOriginReport.painted).toBe(true);
  expect(crossOriginReport.reason).toBe('paint-timing');
});

test('[P1] Paint Timing answers for content the scan cannot enumerate', async ({ page }) => {
  // The preferred signal, and why it is preferred: generated content is painted
  // by the user agent and has no element of its own for a scan to inspect. The
  // scan would reject this document; Paint Timing does not, and it is asked
  // first. Raised by the round-1 track audit.
  const generated = await reportFor(
    page,
    '<style>#p::before { content: "Generated"; color: #111 }</style><div id="p"></div>',
  );
  expect(generated.painted, 'the user agent says this document painted content').toBe(true);
  expect(generated.reason).toBe('paint-timing');

  // And the other half of "preferred, never the only one": a document the user
  // agent reports no contentful paint for still gets a verdict from the scan.
  const scanned = await reportFor(page, '<div style="width:120px;height:80px;background:#ef4444"></div>');
  expect(scanned.reason, 'no contentful paint for a background-only document; the scan answers').toBe('painted');
});

test('[P1] no contentful paint fires for content nobody can see', async ({ page }) => {
  // The measurement the "Paint Timing first" ordering rests on, kept in the
  // repo rather than in a run log. Asking Paint Timing before the scan is only
  // safe because the user agent reports NO contentful paint for the cases this
  // file exists to catch: if that ever changed, preferring it would settle a
  // preview the user sees as blank, and this case is where that would surface.
  const fcpFor = async (body: string): Promise<boolean> => {
    await page.goto('about:blank');
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`,
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 120)));
        }),
    );
    return page.evaluate(() =>
      performance.getEntriesByType('paint').some((entry) => entry.name === 'first-contentful-paint'),
    );
  };

  expect(await fcpFor('<div style="visibility:hidden"><h1>Hidden</h1></div>')).toBe(false);
  expect(await fcpFor('<h1 style="opacity:0">Transparent</h1>')).toBe(false);
  expect(await fcpFor('<div style="width:0;height:0;overflow:hidden"><h1>Clipped</h1></div>')).toBe(false);
  expect(await fcpFor('<h1 style="position:absolute;left:-9999px;top:0">Offscreen</h1>')).toBe(false);
  expect(await fcpFor('<canvas width="200" height="100"></canvas>')).toBe(false);
  expect(await fcpFor('<svg width="200" height="100"></svg>')).toBe(false);
  expect(await fcpFor('<iframe style="width:200px;height:100px;border:0"></iframe>')).toBe(false);
  expect(
    await fcpFor(
      '<div style="position:absolute;left:-9999px;top:0;width:200px;height:100px;overflow:hidden">' +
        '<h1>Clipped away</h1></div>',
    ),
  ).toBe(false);

  // And the other side of the same measurement: these two paint sources fire no
  // contentful paint either, which is why the scan has to enumerate them itself
  // rather than lean on Paint Timing for them.
  expect(await fcpFor('<div style="width:120px;height:80px;box-shadow:0 0 12px 6px #111"></div>')).toBe(false);
  expect(await fcpFor('<div style="width:120px;height:80px;outline:3px solid #111"></div>')).toBe(false);

  // W2H.1d, and the reason the gradient half and the image half of the
  // transparency rule are pinned in different files. A gradient is not an image
  // resource, so no contentful paint fires for one however it is coloured, and
  // the scan decides it. An image IS a resource, and Chromium reports a
  // contentful paint for one whose every pixel is transparent — so for an image
  // Paint Timing, asked first, answers before the scan's image rules are
  // reached. Those rules decide where a user agent reports no paint timing,
  // which the contract allows for a nested browsing context.
  expect(
    await fcpFor(
      '<div style="width:200px;height:120px;background-image:linear-gradient(transparent, transparent)"></div>',
    ),
    'a gradient is not an image resource; no contentful paint fires for one',
  ).toBe(false);
  expect(
    await fcpFor(`<img src="${TRANSPARENT_PNG}" style="width:60px;height:60px">`),
    'Chromium reports a contentful paint for a fully transparent image, which is why the ' +
      'image rules cannot be judged through this path',
  ).toBe(true);

  // What Paint Timing does answer for.
  expect(await fcpFor('<h1>Visible</h1>')).toBe(true);
  expect(
    await fcpFor('<style>#p::before { content: "Generated"; color: #111 }</style><div id="p"></div>'),
    'generated content has no element of its own for the scan to inspect',
  ).toBe(true);
});

test('[P2] the scan is bounded, and says so when it stops early', async ({ page }) => {
  const many = `<div>${'<span style="visibility:hidden">x</span>'.repeat(5000)}</div>`;
  const report = await reportFor(page, many);

  expect(report.painted, 'nothing in this document is visible').toBe(false);
  expect(report.scanTruncated, 'the scan stopped at its bound rather than walking 5000 elements').toBe(true);
  expect(Number(report.counters?.seen)).toBeLessThanOrEqual(400);
});

test('[P2] the scan stays inside its budget on a 5 MB document', async ({ page }) => {
  // The 400-candidate / 50 ms numbers were provisional pending this
  // measurement (D-17 round 2: "Keep 400 pending a real-browser 5 MB
  // benchmark"). The duration is reported to the run log so the numbers can be
  // revisited with evidence rather than adjusted on a guess.
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  const bytes = await page.evaluate(() => {
    const chunk = '<section><p style="visibility:hidden">' + 'y'.repeat(200) + '</p></section>';
    let html = '';
    while (html.length < 5 * 1024 * 1024) html += chunk;
    document.body.innerHTML = html;
    return html.length;
  });
  expect(bytes).toBeGreaterThan(5 * 1024 * 1024 - 1024);
  await page.addScriptTag({ content: PREVIEW_PAINT_REPORT_PRODUCER_SOURCE });

  const measured = await page.evaluate(
    (reportType: string) =>
      new Promise<{ ms: number; report: PaintReport }>((resolve) => {
        let started = 0;
        window.addEventListener('message', (event: MessageEvent) => {
          const data = event.data as { type?: string } | null;
          if (data?.type !== reportType) return;
          resolve({ ms: performance.now() - started, report: data as PaintReport });
        });
        started = performance.now();
        (window as unknown as { __odPreviewPaintReport: { post: () => void } }).__odPreviewPaintReport.post();
      }),
    REPORT,
  );

  // eslint-disable-next-line no-console
  console.log(`[W2H.1b] 5 MB DOM paint scan: ${measured.ms.toFixed(1)} ms, ` +
    `candidates=${String(measured.report.counters?.seen)}, truncated=${String(measured.report.scanTruncated)}`);
  // What the producer governs, and what this case is really for: the scan stops
  // at its own bound instead of walking a 5 MB DOM.
  expect(measured.report.scanTruncated).toBe(true);
  expect(Number(measured.report.counters?.seen)).toBeLessThanOrEqual(400);
  // The wall clock is the machine's as much as the code's — the same call has
  // measured 55 ms idle and 281 ms on a loaded runner, because the first rect
  // read forces a layout of the whole document. So the ceiling is set where it
  // separates a BOUNDED scan from an unbounded one (which would walk ~26k
  // elements and take seconds), not where it separates a fast machine from a
  // busy one. The number that matters is logged above, not asserted.
  expect(measured.ms, 'a scan that ignored its bounds would be seconds, not milliseconds').toBeLessThan(2000);
});
