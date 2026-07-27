import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Capture-hardening (docket mishmash-docket-1-7): today's incident shipped a
// half-done mirror because nothing gated "capture stalled" from "clone
// complete". skills/web-clone/scripts/verify-mirror.mjs is the new mandatory
// gate (promoted from the rescue's RECON-v2/gate.mjs) a mirror must clear
// before it may be reported complete or served to the user: serve it,
// headless-load it at each captured viewport, and fail on any same-origin
// resource failure, any broken image, scrollWidth/scrollHeight drift beyond
// 5% vs a capture-time baseline, or a runtime global/count the baseline
// recorded that the clone doesn't reproduce.
//
// The gate's pass/fail *decision* lives in
// skills/web-clone/scripts/lib/gate-decision.mjs as a pure function over
// already-collected per-viewport data -- no fs/network/browser -- so it is
// unit-testable without Playwright (not a workspace dependency in this
// repo; see SKILL.md). verify-mirror.mjs itself is the thin Playwright glue
// that assembles that data from a real headless run; these tests stand in
// for that collection step with fixture data shaped exactly like what a
// headless crawl of an incomplete-vs-complete mirror would produce.
const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const gateDecisionScriptPath = path.join(
  repoRoot,
  'skills',
  'web-clone',
  'scripts',
  'lib',
  'gate-decision.mjs',
);

type ViewportResult = {
  label: string;
  sameOriginFailures: Array<{ url: string; status?: number; error?: string }>;
  brokenImages: string[];
  scrollWidth: number;
  scrollHeight: number;
  frameworks: Record<string, boolean>;
  canvasCount: number;
  imageCount: number;
  videoCount: number;
};

type Baseline = {
  scrollWidth: number;
  scrollHeight: number;
  frameworks: Record<string, boolean>;
  canvasCount: number;
  imageCount: number;
  videoCount: number;
};

async function loadGateDecision() {
  return (await import(pathToFileURL(gateDecisionScriptPath).href)) as {
    evaluateGate: (input: {
      viewports: ViewportResult[];
      baselineByLabel?: Record<string, Baseline> | null;
      tolerance?: number;
    }) => { pass: boolean; baselineProvided: boolean; checks: Array<Record<string, unknown>> };
  };
}

// A fixture mirror as a live headless crawl would report it: complete (every
// same-origin asset resolves, no broken <img>) vs. incomplete (one asset --
// the fixture's `logo.png` -- was never retrieved by the capture pass and
// 404s when the gate's headless load requests it).
function viewportResult(overrides: Partial<ViewportResult> = {}): ViewportResult {
  return {
    label: '1440',
    sameOriginFailures: [],
    brokenImages: [],
    scrollWidth: 1440,
    scrollHeight: 3000,
    frameworks: { lenis: true, three: false },
    canvasCount: 2,
    imageCount: 5,
    videoCount: 1,
    ...overrides,
  };
}

const baselineByLabel: Record<string, Baseline> = {
  '1440': {
    scrollWidth: 1440,
    scrollHeight: 3000,
    frameworks: { lenis: true, three: false },
    canvasCount: 2,
    imageCount: 5,
    videoCount: 1,
  },
};

describe('evaluateGate (verify-mirror.mjs pure gate decision)', () => {
  it('(b) fails a fixture mirror with a missing asset (404)', async () => {
    const { evaluateGate } = await loadGateDecision();

    const incomplete = viewportResult({
      sameOriginFailures: [{ url: 'http://127.0.0.1:9999/assets/logo.png', status: 404 }],
    });

    const result = evaluateGate({ viewports: [incomplete], baselineByLabel });

    expect(result.pass).toBe(false);
  });

  it('(b) passes the same fixture once complete', async () => {
    const { evaluateGate } = await loadGateDecision();

    const complete = viewportResult();

    const result = evaluateGate({ viewports: [complete], baselineByLabel });

    expect(result.pass).toBe(true);
  });

  it('fails on a broken image even with zero same-origin request failures', async () => {
    const { evaluateGate } = await loadGateDecision();

    const withBrokenImage = viewportResult({ brokenImages: ['http://127.0.0.1:9999/assets/hero.jpg'] });

    const result = evaluateGate({ viewports: [withBrokenImage], baselineByLabel });

    expect(result.pass).toBe(false);
  });

  it('(c) fails on scrollWidth drift beyond the 5% tolerance vs baseline', async () => {
    const { evaluateGate } = await loadGateDecision();

    // designbybrandin.com's real regression: 1440 -> ~6025px unclamped.
    const drifted = viewportResult({ scrollWidth: 6025 });

    const result = evaluateGate({ viewports: [drifted], baselineByLabel });

    expect(result.pass).toBe(false);
  });

  it('(c) passes scrollWidth/scrollHeight within the 5% tolerance vs baseline', async () => {
    const { evaluateGate } = await loadGateDecision();

    // 1764 vs a 1765 baseline -- the real post-fix designbybrandin.com reading.
    const withinTolerance = viewportResult({ scrollWidth: 1440 * 1.03, scrollHeight: 3000 * 0.98 });

    const result = evaluateGate({ viewports: [withinTolerance], baselineByLabel });

    expect(result.pass).toBe(true);
  });

  it('fails when a runtime global recorded true in the baseline is missing from the clone', async () => {
    const { evaluateGate } = await loadGateDecision();

    const missingLenis = viewportResult({ frameworks: { lenis: false, three: false } });

    const result = evaluateGate({ viewports: [missingLenis], baselineByLabel });

    expect(result.pass).toBe(false);
  });

  it('fails when a baseline-recorded count (canvasCount) does not match', async () => {
    const { evaluateGate } = await loadGateDecision();

    const fewerCanvases = viewportResult({ canvasCount: 0 });

    const result = evaluateGate({ viewports: [fewerCanvases], baselineByLabel });

    expect(result.pass).toBe(false);
  });

  it('runs a resource/broken-image-only check when no baseline is supplied', async () => {
    const { evaluateGate } = await loadGateDecision();

    const result = evaluateGate({ viewports: [viewportResult()], baselineByLabel: null });

    expect(result.baselineProvided).toBe(false);
    expect(result.pass).toBe(true);
  });

  it('still fails a same-origin failure when no baseline is supplied', async () => {
    const { evaluateGate } = await loadGateDecision();

    const incomplete = viewportResult({
      sameOriginFailures: [{ url: 'http://127.0.0.1:9999/assets/logo.png', status: 404 }],
    });

    const result = evaluateGate({ viewports: [incomplete], baselineByLabel: null });

    expect(result.pass).toBe(false);
  });
});
