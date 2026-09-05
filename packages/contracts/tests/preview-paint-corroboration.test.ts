// W2I.1 red spec — wave-2 round 3, findings F1 (HIGH) and F6 (MEDIUM). What a
// first contentful paint is allowed to settle on its own, and which gradients
// the scan can read.
//
// F1. `scanForVisibleOutput` returned `painted: true, reason: 'paint-timing'`
// the moment the user agent reported a contentful paint, without asking the
// scan at all. Chromium fires a contentful paint for any decoded image,
// transparent or not, so a document whose only content is a fully transparent
// PNG settled the host watchdog silently: no caveat on the report, no user
// warning, no `preview-error`. D-17 round 5 was right that reversing the
// precedence would reject visible documents (generated content has no element
// for a scan to inspect), so the fix is a THIRD outcome rather than a reversal:
// ask the scan even when Paint Timing answered, and say which of the two the
// settle rests on.
//
//   - the scan CORROBORATES (it found paint it can stand behind) → `evidence`
//     stays null; the settle is proof.
//   - the scan finds only undecidable evidence, or nothing at all → the report
//     still says `painted: true` (the contentful paint is real evidence and
//     nothing should be torn down) and carries
//     `evidence: 'paint-timing-unverified'`, which is the host's cue for a soft
//     "could not verify this rendered" notice and a caveat `preview-error`.
//   - the scan CONTRADICTS it decidably — a CSS paint source whose computed
//     value states full transparency — → `painted: false`. This is the only
//     evidence exact enough to overrule the user agent: a gradient's stops are
//     written in the computed value, while an image's pixels are a 16x16 sample
//     of a resource the frame is usually not allowed to read at all.
//
// F6. `GRADIENT_FUNCTION` matched only unprefixed gradients. Chromium preserves
// `-webkit-linear-gradient` in the computed value, so a fully transparent
// prefixed gradient fell through to the unknown-layer branch, was reported as
// `image-unverified`, and settled a blank preview as painted. Prefixes are
// normalised here, and non-raster CSS uncertainty is reported as
// `css-unverified` so `image-unverified` keeps meaning raster evidence only.
//
// The harness is its own, like `preview-paint-transparent.test.ts`'s: these
// cases need a `performance.getEntriesByType('paint')` that answers per
// document, which that file deliberately holds silent.
import { describe, expect, it } from 'vitest';

import { PREVIEW_PAINT_REPORT_PRODUCER_SOURCE } from '../src/runtime/preview-paint-report';

/** Geometry a fake element reports from `getBoundingClientRect`. */
interface FakeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** What a canvas read of an image's pixels does in the document under test. */
type ImagePixels = 'transparent' | 'opaque' | 'unreadable';

/** One element in the document under test. */
interface FakeElementSpec {
  tag: string;
  rect: FakeRect;
  style?: Record<string, string>;
  text?: string;
  image?: ImagePixels;
  children?: FakeElementSpec[];
}

/** Computed values as Chromium hands them back, for every property the producer reads. */
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
  counters: {
    seen: number;
    hidden: number;
    clipped: number;
    blank: number;
    imageUnverified: number;
    /** Candidates rejected for a CSS paint source read as fully transparent. */
    transparent: number;
    /** Candidates whose only paint source was a CSS construct the scan cannot classify. */
    cssUnverified: number;
  };
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

/** A canvas whose pixel read answers for whichever image was drawn into it. */
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
 * Runs the shipped producer over a document whose only content is `body`, with
 * the user agent's Paint Timing either answering or silent, and returns the
 * report it posts.
 */
function reportFor(body: FakeElementSpec, contentfulPaint: boolean): PaintReport {
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
    createTreeWalker: () => ({
      nextNode: () => (walkerIndex < walkerQueue.length ? walkerQueue[walkerIndex++] : null),
    }),
  };
  const fakePerformance = {
    now: () => 0,
    getEntriesByType: (type: string) =>
      type === 'paint' && contentfulPaint
        ? ([{ name: 'first-contentful-paint', startTime: 12 }] as unknown[])
        : ([] as unknown[]),
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

const BODY_RECT: FakeRect = { left: 0, top: 0, width: VIEWPORT.width, height: VIEWPORT.height };
const BOX_RECT: FakeRect = { left: 0, top: 0, width: 200, height: 120 };

/** A document whose only content is one box under `body`. */
function documentWithBox(
  box: Omit<FakeElementSpec, 'rect'> & { rect?: FakeRect },
  contentfulPaint: boolean,
): PaintReport {
  return reportFor(
    { tag: 'body', rect: BODY_RECT, children: [{ rect: BOX_RECT, ...box }] },
    contentfulPaint,
  );
}

describe('a first contentful paint is corroborated by the scan, never obeyed alone', () => {
  it('settles without a caveat when the scan corroborates the contentful paint', () => {
    const report = documentWithBox(
      { tag: 'div', style: { backgroundColor: 'rgb(37, 99, 235)' } },
      true,
    );

    expect(report.painted).toBe(true);
    expect(report.reason, 'the user agent answered for this document').toBe('paint-timing');
    expect(
      report.evidence,
      'the scan found paint it can stand behind, so the settle needs no caveat',
    ).toBe(null);
  });

  it('names the caveat when the only content is a transparent image', () => {
    // The finding, exactly: Chromium reports a contentful paint for a decoded
    // image whether or not it has visible pixels, so this visually blank
    // document settled the watchdog with nothing said about it.
    const report = documentWithBox({ tag: 'img', image: 'transparent' }, true);

    expect(
      report.painted,
      'the contentful paint is real evidence; nothing is torn down over this',
    ).toBe(true);
    expect(report.reason).toBe('paint-timing');
    expect(
      report.evidence,
      'and the settle rests on the user agent alone, which the report has to say',
    ).toBe('paint-timing-unverified');
  });

  it('names the caveat when the only content is an image nobody may read', () => {
    const report = documentWithBox({ tag: 'img', image: 'unreadable' }, true);

    expect(report.painted).toBe(true);
    expect(report.evidence).toBe('paint-timing-unverified');
  });

  it('names the caveat when the scan finds nothing at all', () => {
    const report = reportFor({ tag: 'body', rect: BODY_RECT }, true);

    expect(report.painted).toBe(true);
    expect(report.evidence).toBe('paint-timing-unverified');
  });

  it('does not settle when a CSS paint source states full transparency', () => {
    // The one class of evidence exact enough to overrule the user agent: the
    // gradient's stops are in the computed value, so this is decidable rather
    // than sampled. Named failure and `preview-error`, as before.
    const report = documentWithBox(
      {
        tag: 'div',
        style: { backgroundImage: 'linear-gradient(rgba(0, 0, 0, 0), rgba(0, 0, 0, 0))' },
      },
      true,
    );

    expect(
      report.painted,
      'every paint source in this document is stated transparent; that outranks the paint entry',
    ).toBe(false);
    expect(report.reason).toBe('no-visible-output');
    expect(report.counters.transparent).toBeGreaterThan(0);
  });

  it('keeps the caveat off a document the scan reads as painted text', () => {
    const report = documentWithBox({ tag: 'div', text: 'Artifact' }, true);

    expect(report.painted).toBe(true);
    expect(report.evidence).toBe(null);
  });

  it('leaves the scan-only verdicts alone when no contentful paint fired', () => {
    const painted = documentWithBox({ tag: 'div', text: 'Artifact' }, false);
    expect(painted.painted).toBe(true);
    expect(painted.reason, 'the scan answered, so it says so').toBe('painted');
    expect(painted.evidence).toBe(null);

    const blank = documentWithBox(
      { tag: 'div', style: { visibility: 'hidden' }, text: 'Hidden' },
      false,
    );
    expect(blank.painted).toBe(false);
    expect(blank.reason).toBe('no-visible-output');
  });
});

describe('a vendor-prefixed gradient is read like an unprefixed one', () => {
  it('does not report painted for a transparent `-webkit-linear-gradient`', () => {
    // Chromium preserves the prefix in the computed value, so this layer fell
    // into the unknown-layer branch, was called `image-unverified`, and settled
    // a blank preview as painted.
    const report = documentWithBox(
      {
        tag: 'div',
        style: { backgroundImage: '-webkit-linear-gradient(rgba(0, 0, 0, 0), transparent)' },
      },
      false,
    );

    expect(report.painted, 'a prefix does not make a transparent gradient ink').toBe(false);
    expect(report.reason).toBe('no-visible-output');
    expect(report.counters.blank).toBeGreaterThan(0);
    expect(report.counters.imageUnverified, 'a gradient is not a raster').toBe(0);
  });

  it('reads every prefix and the repeating forms', () => {
    for (const value of [
      '-moz-radial-gradient(transparent, transparent)',
      '-o-linear-gradient(transparent, transparent)',
      '-webkit-repeating-linear-gradient(transparent, transparent)',
      'repeating-conic-gradient(transparent, transparent)',
      '-webkit-conic-gradient(transparent, transparent)',
    ]) {
      const report = documentWithBox({ tag: 'div', style: { backgroundImage: value } }, false);
      expect(report.painted, `${value} puts no pixels on screen`).toBe(false);
    }
  });

  it('still reports painted for a prefixed gradient with a non-transparent stop', () => {
    const report = documentWithBox(
      { tag: 'div', style: { backgroundImage: '-webkit-linear-gradient(rgb(37, 99, 235), transparent)' } },
      false,
    );

    expect(report.painted).toBe(true);
    expect(report.evidence, 'a colour stop is evidence the report can stand behind').toBe(null);
  });

  it('keeps non-raster CSS uncertainty apart from raster uncertainty', () => {
    // `image-unverified` means "a raster whose pixels this document may not
    // read". A CSS construct the scan cannot classify is a different kind of
    // not-knowing and must not be filed under the raster one.
    const report = documentWithBox(
      { tag: 'div', style: { backgroundImage: 'paint(od-worklet)' } },
      false,
    );

    expect(report.painted).toBe(true);
    expect(report.evidence).toBe('css-unverified');
    expect(report.counters.cssUnverified).toBe(1);
    expect(report.counters.imageUnverified, 'nothing here is a raster').toBe(0);
  });

  it('still calls a background raster image-unverified', () => {
    const report = documentWithBox(
      { tag: 'div', style: { backgroundImage: 'url("artifact.png")' } },
      false,
    );

    expect(report.evidence).toBe('image-unverified');
    expect(report.counters.imageUnverified).toBe(1);
    expect(report.counters.cssUnverified).toBe(0);
  });
});
