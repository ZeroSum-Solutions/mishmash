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

import { PREVIEW_PAINT_REPORT_PRODUCER_SOURCE } from '@open-design/contracts/runtime/preview-paint-report';
import type { Page } from '@playwright/test';

import { expect, test } from '@/playwright/suite';
import { T } from '@/timeouts';

const REPORT = 'od:preview-content-size';

interface PaintReport {
  painted?: unknown;
  reason?: unknown;
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
