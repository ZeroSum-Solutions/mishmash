// @vitest-environment node
//
// Coverage for the rendered layout-risk measurement bridge
// (`injectCompositionMetricsBridge` in `apps/web/src/runtime/srcdoc.ts`).
// Uses the same "extract the injected <script>, eval it in a JSDOM window
// with a mocked parent" technique the tweaks-bridge suite uses
// (srcdoc-tweaks-bridge.test.ts) — this proves the REAL injected script, not
// a re-implementation of its logic.
//
// JSDOM has no real layout engine (`getBoundingClientRect` always returns
// zeros), so the two geometry-based metrics (distinctSectionWidthCount,
// fullBleedAgainstContained) are proven by stubbing `getBoundingClientRect`
// per section rather than by real layout — everything else (position,
// z-index, transform, background-color, font-size) is a CSS-cascade value
// JSDOM resolves for real from the `<style>` block, so those are proven
// against genuine `getComputedStyle` output.

import { describe, expect, it, vi } from 'vitest';
import { JSDOM, type DOMWindow } from 'jsdom';
import { buildSrcdoc } from '../../src/runtime/srcdoc';

const MARKER = 'data-od-composition-metrics-bridge';

function extractScript(srcdoc: string): string {
  const match = srcdoc.match(new RegExp(`<script ${MARKER}>([\\s\\S]*?)</script>`));
  if (!match || !match[1]) throw new Error(`${MARKER} script not found in srcdoc`);
  return match[1];
}

type CompositionMetricsMessage = {
  type: string;
  metrics?: {
    sectionCount: number;
    outOfFlowElementCount: number;
    transformedElementCount: number;
    distinctSectionBackgroundCount: number;
    distinctSectionWidthCount: number;
    fullBleedAgainstContained: boolean;
    bodyFontSizePx: number;
    maxDisplayFontSizePx: number;
    displayToBodyFontRatio: number;
    measuredAt: string;
  };
};

async function setupBridge(bodyHtml: string, rects?: Record<string, { width: number }>) {
  const srcdoc = buildSrcdoc(`<!doctype html><html><body>${bodyHtml}</body></html>`, {});
  const script = extractScript(srcdoc);
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    runScripts: 'outside-only',
    // The bridge schedules its measurement via requestAnimationFrame, which
    // JSDOM only implements when the window "pretends to be visual" — without
    // this the call is undefined and the bridge's message listener throws
    // silently (dispatchEvent swallows listener exceptions per spec).
    pretendToBeVisual: true,
  });
  const win = dom.window;
  const parentPostMessage = vi.fn();
  Object.defineProperty(win, 'parent', {
    configurable: true,
    value: { postMessage: parentPostMessage },
  });
  // JSDOM has no layout engine — every element's real getBoundingClientRect
  // is zeros. Stub it per-section via a data-rect-w attribute in the fixture
  // markup so the two geometry-derived metrics are exercised deterministically.
  win.Element.prototype.getBoundingClientRect = function (this: Element) {
    const key = this.getAttribute('data-rect-w');
    const width = key ? Number(key) : 0;
    return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect;
  };
  if (rects) {
    // Optional viewport override via documentElement's own rect width isn't
    // used by the bridge (it reads clientWidth); tests set clientWidth
    // directly where full-bleed detection matters.
    void rects;
  }
  new win.Function(script).call(win);
  if (win.document.readyState === 'loading') {
    await new Promise<void>((resolve) => {
      win.document.addEventListener('DOMContentLoaded', () => resolve());
    });
  }
  return { win, parentPostMessage, srcdoc };
}

function messagesOfType(parentPostMessage: ReturnType<typeof vi.fn>, type: string): CompositionMetricsMessage[] {
  return parentPostMessage.mock.calls.map((call) => call[0]).filter((m) => m?.type === type);
}

async function requestMeasurement(win: DOMWindow, parentPostMessage: ReturnType<typeof vi.fn>) {
  parentPostMessage.mockClear();
  win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'od:composition-metrics-request' } }));
  // The bridge schedules its post via requestAnimationFrame — jsdom's rAF is
  // a real (short) timer, so a small real wait is enough to observe it.
  for (let i = 0; i < 20; i++) {
    if (messagesOfType(parentPostMessage, 'od:composition-metrics').length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return messagesOfType(parentPostMessage, 'od:composition-metrics').at(-1)?.metrics;
}

describe('composition-metrics bridge — always injected', () => {
  it('ships in every srcDoc build with no options flag', () => {
    const srcdoc = buildSrcdoc('<!doctype html><html><body>plain</body></html>', {});
    expect(srcdoc).toContain(MARKER);
    expect(srcdoc).toContain("type: 'od:composition-metrics'");
  });
});

describe('composition-metrics bridge — out-of-flow + transform (CSS-cascade, real getComputedStyle)', () => {
  it('counts a sticky+z-index section as out of flow, and leaves a plain section uncounted', async () => {
    const body = `
      <style>
        .sticky { position: sticky; z-index: 5; }
      </style>
      <section class="sticky" data-rect-w="800"><h1>Hero</h1></section>
      <section data-rect-w="800">Plain</section>
    `;
    const { win, parentPostMessage } = await setupBridge(body);
    const metrics = await requestMeasurement(win, parentPostMessage);
    expect(metrics?.sectionCount).toBe(2);
    expect(metrics?.outOfFlowElementCount).toBe(1);
  });

  it('does NOT count position without z-index — the exact false-negative the source lint has', async () => {
    // layout-risk-flat (apps/daemon/src/lint-artifact.ts) requires BOTH
    // position AND z-index; this bridge mirrors that pairing exactly so the
    // two signals stay comparable.
    const body = `
      <style>
        nav { position: sticky; }
      </style>
      <nav data-rect-w="800">Nav</nav>
      <section data-rect-w="800">One</section>
      <section data-rect-w="800">Two</section>
    `;
    const { win, parentPostMessage } = await setupBridge(body);
    const metrics = await requestMeasurement(win, parentPostMessage);
    expect(metrics?.outOfFlowElementCount).toBe(0);
  });

  it('counts a rotated element as transformed, and a plain one as not', async () => {
    const body = `
      <style>
        .tilt { transform: rotate(4deg); }
      </style>
      <section data-rect-w="800"><div class="tilt">Card</div></section>
      <section data-rect-w="800">Plain</section>
    `;
    const { win, parentPostMessage } = await setupBridge(body);
    const metrics = await requestMeasurement(win, parentPostMessage);
    expect(metrics?.transformedElementCount).toBe(1);
  });

  it('never counts a hover-only transform — measurement reflects the resting state', async () => {
    const body = `
      <style>
        .card:hover { transform: scale(1.05); }
      </style>
      <section data-rect-w="800"><div class="card">Card</div></section>
    `;
    const { win, parentPostMessage } = await setupBridge(body);
    const metrics = await requestMeasurement(win, parentPostMessage);
    // Nothing is hovering in this test, so getComputedStyle never resolves
    // the :hover rule — this is real browser semantics, not a bridge special case.
    expect(metrics?.transformedElementCount).toBe(0);
  });
});

describe('composition-metrics bridge — distinct section backgrounds (real getComputedStyle)', () => {
  it('counts distinct backgroundColor values across sections', async () => {
    const body = `
      <style>
        .a { background-color: #ffffff; }
        .b { background-color: #111111; }
      </style>
      <section class="a" data-rect-w="800">One</section>
      <section class="a" data-rect-w="800">Two</section>
      <section class="b" data-rect-w="800">Three</section>
    `;
    const { win, parentPostMessage } = await setupBridge(body);
    const metrics = await requestMeasurement(win, parentPostMessage);
    expect(metrics?.distinctSectionBackgroundCount).toBe(2);
  });
});

describe('composition-metrics bridge — section widths + full-bleed (stubbed geometry)', () => {
  it('reports one distinct width when every section renders the same width', async () => {
    const body = `
      <section data-rect-w="1200">One</section>
      <section data-rect-w="1200">Two</section>
      <section data-rect-w="1200">Three</section>
    `;
    const { win, parentPostMessage } = await setupBridge(body);
    const metrics = await requestMeasurement(win, parentPostMessage);
    expect(metrics?.distinctSectionWidthCount).toBe(1);
    expect(metrics?.fullBleedAgainstContained).toBe(false);
  });

  it('detects a full-bleed section next to a contained one', async () => {
    const body = `
      <section data-rect-w="1440">Full bleed</section>
      <section data-rect-w="960">Contained</section>
    `;
    const { win, parentPostMessage } = await setupBridge(body);
    Object.defineProperty(win.document.documentElement, 'clientWidth', { value: 1440, configurable: true });
    const metrics = await requestMeasurement(win, parentPostMessage);
    expect(metrics?.distinctSectionWidthCount).toBe(2);
    expect(metrics?.fullBleedAgainstContained).toBe(true);
  });
});

describe('composition-metrics bridge — display:body font ratio (real getComputedStyle)', () => {
  it('reports the largest font-size on the page against the body size', async () => {
    const body = `
      <style>
        body { font-size: 14px; }
        h1 { font-size: 140px; }
      </style>
      <section data-rect-w="800"><h1>Display line</h1><p>Body copy</p></section>
    `;
    const { win, parentPostMessage } = await setupBridge(body);
    const metrics = await requestMeasurement(win, parentPostMessage);
    expect(metrics?.bodyFontSizePx).toBe(14);
    expect(metrics?.maxDisplayFontSizePx).toBe(140);
    expect(metrics?.displayToBodyFontRatio).toBeCloseTo(10, 1);
  });
});

describe('composition-metrics bridge — zero sections', () => {
  it('reports zero counts rather than throwing on a sectionless fragment', async () => {
    const { win, parentPostMessage } = await setupBridge('<main>Hello</main>');
    const metrics = await requestMeasurement(win, parentPostMessage);
    expect(metrics?.sectionCount).toBe(0);
    expect(metrics?.distinctSectionBackgroundCount).toBe(0);
    expect(metrics?.distinctSectionWidthCount).toBe(0);
    expect(metrics?.fullBleedAgainstContained).toBe(false);
  });
});
