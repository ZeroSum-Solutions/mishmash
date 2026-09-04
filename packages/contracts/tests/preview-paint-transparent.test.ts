// W2H.1d red spec — D-17 dialogue round 4, the blocking finding "transparent
// output". What the paint scan is allowed to call visible.
//
// `paintsSomething` accepted every `background-image` that was not `none`, and
// counted every decoded `img` with intrinsic size. So a visible box whose only
// paint source was `linear-gradient(transparent, transparent)` reported
// `painted: true`, and so did a fully transparent image. Both are visually
// blank documents settling the host watchdog on nothing.
//
// GPT-5.6 round 4: "`paintsSomething` accepts every non-`none`
// `backgroundImage` without checking whether it has visible pixels. Executing
// the shipped producer with a visible box whose sole paint source was
// `linear-gradient(transparent, transparent)` returned `painted:true`. A
// decoded, intrinsically sized but fully transparent image follows the same
// false-positive path."
//
// The two halves are not equally decidable, and the fix must not pretend they
// are:
//
//   - A gradient states its colour stops in the computed value, so a gradient
//     whose every stop is transparent is DECIDABLY not paint.
//   - A raster image states nothing. Its pixels are readable only through an
//     untainted canvas, which needs a same-origin image; a cross-origin one
//     throws `SecurityError` from `getImageData`. Where the pixels cannot be
//     read the honest answer is neither "painted" nor "blank": the report says
//     `painted: true` AND carries `evidence: 'image-unverified'`, so nothing
//     downstream mistakes an unread image for proof.
//
// A real browser judges the browser half of this — which values Chromium
// computes, which images taint a canvas, and which documents fire a contentful
// paint (`e2e/ui/preview-visible-output.test.ts`). This file judges the
// DECISION, with Paint Timing silent and the pixel read stated outright, which
// is the condition the scan actually decides under: Paint Timing is optional
// in a nested browsing context, and where a user agent does not report it the
// scan is the only answer the host gets.
//
// The harness is deliberately its own: unlike `preview-paint-clip.test.ts`,
// which needs geometry, these cases need a `document.createElement('canvas')`
// whose pixel read is stated per image.
import { describe, expect, it } from 'vitest';

import { PREVIEW_PAINT_REPORT_PRODUCER_SOURCE } from '../src/runtime/preview-paint-report';

/** Geometry a fake element reports from `getBoundingClientRect`. */
interface FakeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * What a canvas read of an image's pixels does in the document under test.
 *
 *  - `transparent` / `opaque` — readable, so `getImageData` answers.
 *  - `unreadable` — a cross-origin image tainted the canvas and `getImageData`
 *    throws `SecurityError`, which is what happens to every http(s) image in
 *    the sandboxed opaque-origin preview frame.
 */
type ImagePixels = 'transparent' | 'opaque' | 'unreadable';

/** One element in the document under test. */
interface FakeElementSpec {
  tag: string;
  rect: FakeRect;
  /** Computed-style overrides; everything else takes the initial value below. */
  style?: Record<string, string>;
  /** A direct text child, when the element is meant to paint text. */
  text?: string;
  /** For an `img`: decoded with intrinsic size, and what its pixels read as. */
  image?: ImagePixels;
  children?: FakeElementSpec[];
}

/**
 * Computed values for every property the producer reads, as Chromium hands
 * them back: fully-resolved strings, a transparent colour spelled
 * `rgba(0, 0, 0, 0)`, a border width spelled `'0px'`.
 */
const INITIAL_STYLE: Record<string, string> = {
  display: 'block',
  visibility: 'visible',
  clipPath: 'none',
  opacity: '1',
  overflow: 'visible',
  overflowX: 'visible',
  overflowY: 'visible',
  color: 'rgb(0, 0, 0)',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  backgroundImage: 'none',
  borderTopStyle: 'none',
  borderRightStyle: 'none',
  borderBottomStyle: 'none',
  borderLeftStyle: 'none',
  borderTopWidth: '0px',
  borderRightWidth: '0px',
  borderBottomWidth: '0px',
  borderLeftWidth: '0px',
  borderTopColor: 'rgb(0, 0, 0)',
  borderRightColor: 'rgb(0, 0, 0)',
  borderBottomColor: 'rgb(0, 0, 0)',
  borderLeftColor: 'rgb(0, 0, 0)',
  boxShadow: 'none',
  outlineStyle: 'none',
  outlineWidth: '0px',
  outlineColor: 'rgb(0, 0, 0)',
  fill: 'rgb(0, 0, 0)',
  stroke: 'none',
  strokeWidth: '1px',
};

interface FakeTextNode {
  nodeType: 3;
  nodeValue: string;
}

interface FakeElement {
  tagName: string;
  parentElement: FakeElement | null;
  childNodes: Array<FakeElement | FakeTextNode>;
  computedStyle: Record<string, string>;
  getBoundingClientRect(): FakeRect;
  complete?: boolean;
  naturalWidth?: number;
  naturalHeight?: number;
  pixels?: ImagePixels;
}

/** What the producer posted to its host. */
interface PaintReport {
  painted: boolean;
  reason: string;
  evidence: string | null;
  counters: { seen: number; hidden: number; clipped: number; blank: number; imageUnverified: number };
}

const VIEWPORT = { width: 800, height: 600 };

function buildElement(spec: FakeElementSpec, parent: FakeElement | null): FakeElement {
  const element: FakeElement = {
    tagName: spec.tag.toUpperCase(),
    parentElement: parent,
    childNodes: [],
    computedStyle: { ...INITIAL_STYLE, ...(spec.style ?? {}) },
    getBoundingClientRect: () => spec.rect,
  };
  if (spec.image !== undefined) {
    element.complete = true;
    element.naturalWidth = 2;
    element.naturalHeight = 2;
    element.pixels = spec.image;
  }
  if (spec.text !== undefined) {
    element.childNodes.push({ nodeType: 3, nodeValue: spec.text });
  }
  for (const child of spec.children ?? []) {
    element.childNodes.push(buildElement(child, element));
  }
  return element;
}

function elementDescendants(root: FakeElement): FakeElement[] {
  const found: FakeElement[] = [];
  for (const node of root.childNodes) {
    if ((node as FakeTextNode).nodeType === 3) continue;
    const element = node as FakeElement;
    found.push(element, ...elementDescendants(element));
  }
  return found;
}

/**
 * A canvas whose pixel read answers for whichever image was drawn into it —
 * `SecurityError` when that image is the cross-origin one, an alpha channel
 * otherwise. Nothing else about a canvas is modelled; the producer only draws
 * and reads.
 */
function buildCanvas(): Record<string, unknown> {
  let drawn: FakeElement | null = null;
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      clearRect: () => {},
      drawImage: (source: FakeElement) => {
        drawn = source;
      },
      getImageData: (_x: number, _y: number, width: number, height: number) => {
        if (drawn === null || drawn.pixels === 'unreadable') {
          const error = new Error('Tainted canvases may not be exported.');
          error.name = 'SecurityError';
          throw error;
        }
        const data = new Uint8ClampedArray(width * height * 4);
        if (drawn.pixels === 'opaque') {
          for (let index = 3; index < data.length; index += 4) data[index] = 255;
        }
        return { data };
      },
    }),
  };
}

/**
 * Runs the shipped producer over a document whose only content is `body`, and
 * returns the report it posts. The producer reads `window`, `document` and
 * `performance` as free variables, so they are supplied as arguments.
 */
function reportFor(body: FakeElementSpec): PaintReport {
  const bodyElement = buildElement(body, null);
  const posted: PaintReport[] = [];
  const fakeWindow: Record<string, unknown> = {
    innerWidth: VIEWPORT.width,
    innerHeight: VIEWPORT.height,
    parent: {
      postMessage: (message: PaintReport) => {
        posted.push(message);
      },
    },
    getComputedStyle: (element: FakeElement) => element.computedStyle,
  };
  const walkerQueue = elementDescendants(bodyElement);
  let walkerIndex = 0;
  const fakeDocument = {
    body: bodyElement,
    documentElement: {
      scrollWidth: VIEWPORT.width,
      offsetWidth: VIEWPORT.width,
      clientWidth: VIEWPORT.width,
      clientHeight: VIEWPORT.height,
    },
    createElement: (tag: string) => (tag === 'canvas' ? buildCanvas() : {}),
    // No `elementsFromPoint`: the hit-test pass is a shortcut into the same
    // candidate check, and leaving it out keeps the walk order stated here.
    createTreeWalker: () => ({
      nextNode: () => (walkerIndex < walkerQueue.length ? walkerQueue[walkerIndex++] : null),
    }),
  };
  const fakePerformance = {
    now: () => 0,
    // No contentful-paint entry: the scan is what answers, which is the half
    // of the producer this file is about.
    getEntriesByType: () => [] as unknown[],
  };

  const run = new Function(
    'window',
    'document',
    'performance',
    PREVIEW_PAINT_REPORT_PRODUCER_SOURCE,
  ) as (w: unknown, d: unknown, p: unknown) => void;
  run(fakeWindow, fakeDocument, fakePerformance);
  (fakeWindow.__odPreviewPaintReport as { post: () => void }).post();

  const report = posted[0];
  expect(report, 'the producer posts exactly one report per call').toBeDefined();
  return report!;
}

/** A body box that fills the viewport and paints nothing of its own. */
const BODY_RECT: FakeRect = { left: 0, top: 0, width: VIEWPORT.width, height: VIEWPORT.height };
const BOX_RECT: FakeRect = { left: 0, top: 0, width: 200, height: 120 };

/** A document whose only content is one box under `body`. */
function documentWithBox(box: Omit<FakeElementSpec, 'rect'> & { rect?: FakeRect }): PaintReport {
  return reportFor({
    tag: 'body',
    rect: BODY_RECT,
    children: [{ rect: BOX_RECT, ...box }],
  });
}

describe('a gradient with nothing but transparent stops is not visible output', () => {
  it('does not report painted for `linear-gradient(transparent, transparent)`', () => {
    const report = documentWithBox({
      tag: 'div',
      style: { backgroundImage: 'linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, 0))' },
    });

    expect(
      report.painted,
      'a gradient every stop of which is transparent puts no pixels on screen',
    ).toBe(false);
    expect(report.reason).toBe('no-visible-output');
    expect(report.counters.blank, 'the box was rejected for painting nothing').toBeGreaterThan(0);
  });

  it('reads transparency in every colour spelling a stop can take', () => {
    const report = documentWithBox({
      tag: 'div',
      style: {
        backgroundImage:
          'linear-gradient(transparent, hsla(210, 100%, 50%, 0)), ' +
          'radial-gradient(#2563eb00, color(srgb 0 0 1 / 0))',
      },
    });

    expect(
      report.painted,
      'a zero alpha is a zero alpha however the stop is written',
    ).toBe(false);
  });

  it('treats a stop it cannot read as ink, not as nothing', () => {
    // Round-1 track audit, finding 2. The rule is "every stop READ and
    // transparent", not "every stop this happened to match": a layer holding a
    // colour construct the scrape does not recognise — a nested function such
    // as `color-mix()` — beside a `transparent` stop would otherwise read as
    // all-transparent, and a painted box would be called blank. Chromium
    // resolves `color-mix()` to `color(srgb ...)` in the computed value, so no
    // live path in this browser reaches it; the rule has to hold anyway,
    // because failing toward blank is the one direction this detector must
    // never take.
    const report = documentWithBox({
      tag: 'div',
      style: { backgroundImage: 'linear-gradient(color-mix(in srgb, red, white), transparent)' },
    });

    expect(report.painted, 'an unreadable stop is assumed to ink').toBe(true);
    expect(report.evidence).toBe(null);
  });

  it('reads a malformed hex colour as opaque, not as transparent', () => {
    // Round-1 track audit, finding 4, and the same direction as the case above:
    // `parseInt` on non-hex digits is NaN, and NaN read as an alpha of zero
    // would have called this box blank.
    const report = documentWithBox({
      tag: 'div',
      style: { backgroundImage: 'linear-gradient(#zzzzz, #zzzzz)' },
    });

    expect(report.painted, 'a colour this cannot parse is opaque, never invisible').toBe(true);
  });

  it('still reports painted for a gradient with one non-transparent stop', () => {
    // The other side of the rule: a gradient that fades to nothing still inks
    // the end it starts from, and calling it blank would report a healthy
    // preview as broken.
    const report = documentWithBox({
      tag: 'div',
      style: { backgroundImage: 'linear-gradient(rgb(37, 99, 235), rgba(0, 0, 0, 0))' },
    });

    expect(report.painted).toBe(true);
    expect(report.reason).toBe('painted');
    expect(report.evidence, 'a colour stop is evidence the report can stand behind').toBe(null);
  });
});

describe('an image whose pixels cannot be read is reported as unverified, not as proof', () => {
  it('does not report painted for a readable, fully transparent image', () => {
    const report = documentWithBox({ tag: 'img', image: 'transparent' });

    expect(
      report.painted,
      'a decoded image every pixel of which is transparent is a blank rectangle',
    ).toBe(false);
    expect(report.reason).toBe('no-visible-output');
    expect(report.counters.blank).toBeGreaterThan(0);
    expect(report.counters.imageUnverified, 'the pixels were read, so nothing is unverified').toBe(0);
  });

  it('reports painted for a readable image with opaque pixels', () => {
    const report = documentWithBox({ tag: 'img', image: 'opaque' });

    expect(report.painted).toBe(true);
    expect(report.evidence, 'the pixels were read; this needs no caveat').toBe(null);
  });

  it('reports an unreadable image as painted AND says the evidence is unverified', () => {
    const report = documentWithBox({ tag: 'img', image: 'unreadable' });

    expect(
      report.painted,
      'a decoded image with intrinsic size is not assumed blank on a guess',
    ).toBe(true);
    expect(
      report.evidence,
      'and it is not assumed visible on a guess either: the report says the pixels were never read',
    ).toBe('image-unverified');
    expect(report.counters.imageUnverified).toBe(1);
  });

  it('reports a `background-image: url(...)` as unverified too', () => {
    const report = documentWithBox({
      tag: 'div',
      style: { backgroundImage: 'url("artifact.png")' },
    });

    expect(report.painted).toBe(true);
    expect(report.evidence, 'a background raster is as unreadable as an `img` is').toBe(
      'image-unverified',
    );
    expect(report.counters.imageUnverified).toBe(1);
  });

  it('prefers evidence it can stand behind when the document has both', () => {
    // An unverified candidate does not stop the scan: a document that also
    // contains something decidably visible reports the decidable evidence.
    const report = reportFor({
      tag: 'body',
      rect: BODY_RECT,
      children: [
        { tag: 'img', rect: BOX_RECT, image: 'unreadable' },
        {
          tag: 'div',
          rect: { left: 0, top: 200, width: 200, height: 120 },
          style: { backgroundColor: 'rgb(239, 68, 68)' },
        },
      ],
    });

    expect(report.painted).toBe(true);
    expect(
      report.evidence,
      'the opaque background is proof; the unread image did not have to be trusted',
    ).toBe(null);
    expect(report.counters.imageUnverified, 'the unread image is still counted').toBe(1);
  });
});
