// W2H.1c red spec — D-17 dialogue round 3, blocking finding 1. What an EMPTY
// clipping intersection means.
//
// `intersect(a, b)` in the shipped producer returns `null` for an empty
// intersection, and every caller reads `null` as UNBOUNDED (`if (!b) return
// a`). So the two opposite facts — "no ancestor constrains this box" and
// "the constraint collapsed to nothing" — are the same value. An
// `overflow:hidden` ancestor laid out fully offscreen sets `clipChildren` to
// the empty intersection, the descendant reads that as "unclipped", and a
// document nobody can see reports `painted: true`.
//
// GPT-5.6 round 3: "a fully offscreen overflow:hidden ancestor sets
// clipChildren = null, after which a descendant with visible text passes the
// clip check and the producer reports painted: true", verified by executing the
// shipped producer on that geometry.
//
// A real browser judges the CSS half of this (`e2e/ui/preview-visible-output.
// test.ts`). This file judges the clip algebra itself: the producer source is
// executed against a hand-built element graph whose rects and computed styles
// are stated outright, so the empty-versus-unbounded distinction is asserted
// without a layout engine in the way.
import { describe, expect, it } from 'vitest';

import { PREVIEW_PAINT_REPORT_PRODUCER_SOURCE } from '../src/runtime/preview-paint-report';

/** Geometry a fake element reports from `getBoundingClientRect`. */
interface FakeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** One element in the document under test. */
interface FakeElementSpec {
  tag: string;
  rect: FakeRect;
  /** Computed-style overrides; everything else takes the initial value below. */
  style?: Record<string, string>;
  /** A direct text child, when the element is meant to paint text. */
  text?: string;
  children?: FakeElementSpec[];
}

/**
 * Computed values for every property the producer reads. Chromium hands back
 * fully-resolved strings, so the fake does too — a border width is `'0px'`, not
 * `0`, and a transparent colour is `'rgba(0, 0, 0, 0)'`.
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
}

/** What the producer posted to its host. */
interface PaintReport {
  painted: boolean;
  reason: string;
  counters: { seen: number; hidden: number; clipped: number; blank: number };
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
 * Runs the shipped producer over a document whose only content is `body`, and
 * returns the report it posts. The producer reads `window`, `document` and
 * `performance` as free variables, so they are supplied as arguments; nothing
 * else it touches (`Math`, `Number`, `WeakMap`, `WeakSet`, `Date`) is
 * environment-specific.
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
  const documentElement = {
    scrollWidth: VIEWPORT.width,
    offsetWidth: VIEWPORT.width,
    clientWidth: VIEWPORT.width,
    clientHeight: VIEWPORT.height,
  };
  const walkerQueue = elementDescendants(bodyElement);
  let walkerIndex = 0;
  const fakeDocument = {
    body: bodyElement,
    documentElement,
    // No `elementsFromPoint`: the hit-test pass is a shortcut into the same
    // candidate check, and leaving it out keeps the walk order stated here.
    createTreeWalker: () => ({
      nextNode: () => (walkerIndex < walkerQueue.length ? walkerQueue[walkerIndex++] : null),
    }),
  };
  const fakePerformance = {
    now: () => 0,
    // No contentful-paint entry, so the scan is what answers — which is the
    // half of the producer this file is about.
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
  expect(posted).toHaveLength(1);
  return report!;
}

/** A body box that fills the viewport and paints nothing of its own. */
const BODY_RECT: FakeRect = { left: 0, top: 0, width: VIEWPORT.width, height: VIEWPORT.height };

describe('an empty clipping intersection is not an absent one', () => {
  it('does not report painted for text inside a fully offscreen overflow:hidden ancestor', () => {
    const report = reportFor({
      tag: 'body',
      rect: BODY_RECT,
      children: [
        {
          tag: 'div',
          // Laid out entirely to the left of the viewport, and clipping its
          // children: nothing inside it can reach the screen.
          rect: { left: -9999, top: 0, width: 200, height: 100 },
          style: { overflow: 'hidden', overflowX: 'hidden', overflowY: 'hidden' },
          children: [
            { tag: 'h1', rect: { left: -9999, top: 0, width: 200, height: 40 }, text: 'Offscreen' },
          ],
        },
      ],
    });

    expect(
      report.painted,
      'the clip collapsed to nothing, so nothing inside the ancestor is visible output',
    ).toBe(false);
    expect(report.reason).toBe('no-visible-output');
    expect(report.counters.clipped, 'the text was rejected by the clip, not by its own box').toBeGreaterThan(0);
  });

  it('does not report painted for a laid-out child of a zero-area overflow:hidden ancestor', () => {
    const report = reportFor({
      tag: 'body',
      rect: BODY_RECT,
      children: [
        {
          tag: 'div',
          rect: { left: 0, top: 0, width: 0, height: 0 },
          style: { overflow: 'hidden', overflowX: 'hidden', overflowY: 'hidden' },
          children: [
            // An absolutely positioned child keeps a real box of its own while
            // its clipping ancestor has none.
            { tag: 'h1', rect: { left: 20, top: 20, width: 200, height: 40 }, text: 'Clipped' },
          ],
        },
      ],
    });

    expect(
      report.painted,
      'a zero-area scrollport clips every descendant away, however large the descendant box is',
    ).toBe(false);
    expect(report.reason).toBe('no-visible-output');
  });

  it('still reports painted for text an ancestor scrollport only partly clips', () => {
    // The other side of the same rule: an intersection that survives is not
    // empty, and treating every clip as empty would report a healthy preview
    // as blank.
    const report = reportFor({
      tag: 'body',
      rect: BODY_RECT,
      children: [
        {
          tag: 'div',
          rect: { left: 0, top: 0, width: 200, height: 100 },
          style: { overflow: 'hidden', overflowX: 'hidden', overflowY: 'hidden' },
          children: [
            { tag: 'h1', rect: { left: 0, top: 0, width: 600, height: 40 }, text: 'Partly visible' },
          ],
        },
      ],
    });

    expect(report.painted, 'the visible half of a clipped box is still visible output').toBe(true);
    expect(report.reason).toBe('painted');
  });
});
