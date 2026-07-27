import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Capture-hardening (docket mishmash-docket-1-7): today's incident shipped a
// half-done mirror because nothing gated "capture stalled" from "clone
// complete". skills/web-clone/scripts/verify-mirror.mjs is the new mandatory
// gate (promoted from the rescue's RECON-v2/gate.mjs) a mirror must clear
// before it may be reported complete or served to the user: serve it,
// headless-load it at each captured viewport, and fail on any same-origin
// resource failure, any request that leaked to the mirror's original live
// origin, any broken image, scrollWidth/scrollHeight drift beyond 5% vs a
// capture-time baseline, or a runtime global/count the baseline recorded
// that the clone doesn't reproduce.
//
// The gate's pass/fail *decision* lives in
// skills/web-clone/scripts/lib/gate-decision.mjs as a pure function over
// already-collected per-viewport data -- no fs/network/browser -- so it is
// unit-testable without Playwright (not a workspace dependency in this
// repo; see SKILL.md). verify-mirror.mjs itself is the thin Playwright glue
// that assembles that data from a real headless run; these tests stand in
// for that collection step with fixture data shaped exactly like what a
// headless crawl of an incomplete-vs-complete mirror would produce.
//
// Round-2 additions (adversarial review): F2 (baseline validation must fail
// closed on empty/incomplete/malformed input), F4 (the scroll-animation
// clamp deliberately makes a clamped mirror's scrollWidth differ from the
// raw live baseline -- the gate must not reject that fix, nor fail open on a
// genuinely broken wide mirror that was never clamped), F18 (pin the exact
// 5% tolerance boundary with explicit cases).
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
  originLeaks?: Array<{ url: string; status?: number; error?: string }>;
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
  expectedScrollWidth?: number;
  frameworks: Record<string, boolean>;
  canvasCount: number;
  imageCount: number;
  videoCount: number;
};

type GateResult = { pass: boolean; baselineProvided: boolean; checks: Array<Record<string, unknown>> };

type ValidationResult =
  | { ok: true; baselineByLabel: Record<string, Baseline> }
  | { ok: false; error: string };

async function loadGateDecision() {
  return (await import(pathToFileURL(gateDecisionScriptPath).href)) as {
    evaluateGate: (input: {
      viewports: ViewportResult[];
      baselineByLabel?: Record<string, Baseline> | null;
      tolerance?: number;
    }) => GateResult;
    validateBaselineDocument: (baselineDoc: unknown, requiredLabels?: string[]) => ValidationResult;
    withinTolerance: (actual: number, expected: number, tolerance?: number) => boolean;
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
    originLeaks: [],
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

// F2: a complete metric now needs frameworks + all three counts, not just
// scroll dimensions -- validating scroll dims alone let a baseline missing
// origin/frameworks/counts pass as `ok:true`, silently disabling those
// gates. Named so each negative test below can spread this and override
// JUST the one field it means to break, keeping each test isolated to the
// specific failure it claims to exercise.
function completeMetric(label: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    viewport: { label, width: 1440, height: 900, dpr: 1 },
    scrollWidth: 1440,
    scrollHeight: 3000,
    frameworks: { lenis: true, three: false },
    canvasCount: 2,
    imageCount: 5,
    videoCount: 1,
    ...overrides,
  };
}

function validBaselineDoc(overrides: Partial<{ origin: unknown; metrics: unknown[] }> = {}) {
  return {
    capturedAt: '2026-07-27T00:00:00.000Z',
    origin: 'https://example.com',
    metrics: [
      completeMetric('1440'),
      completeMetric('768', { viewport: { label: '768', width: 768, height: 900, dpr: 1 }, scrollWidth: 768, scrollHeight: 3200 }),
      completeMetric('390', { viewport: { label: '390', width: 390, height: 844, dpr: 2 }, scrollWidth: 390, scrollHeight: 3400 }),
    ],
    ...overrides,
  };
}

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

  // F1: an asset the capture never downloaded stays absolute after the
  // rewrite pass, so it loads fine from the still-live original origin
  // during verification -- no request fails, but the mirror is silently
  // still proxying the live site. This must fail regardless of HTTP status.
  it('(F1) fails when a request leaked back to the original live origin, even with no same-origin failures', async () => {
    const { evaluateGate } = await loadGateDecision();

    const leaking = viewportResult({
      originLeaks: [{ url: 'https://example.com/app.js', status: 200 }],
    });

    const result = evaluateGate({ viewports: [leaking], baselineByLabel });

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

  // F18: pin the exact 5% boundary so a silent regression to (say) 10%
  // tolerance would be caught, and cover the negative-drift and
  // zero-baseline edges the original tests never exercised.
  describe('(F18) 5% tolerance boundary', () => {
    it('passes at exactly 5% drift (boundary is inclusive)', async () => {
      const { evaluateGate } = await loadGateDecision();
      const atBoundary = viewportResult({ scrollWidth: 1440 * 1.05 });

      const result = evaluateGate({ viewports: [atBoundary], baselineByLabel });

      expect(result.pass).toBe(true);
    });

    it('fails just above 5% drift', async () => {
      const { evaluateGate } = await loadGateDecision();
      const justOver = viewportResult({ scrollWidth: 1440 * 1.0501 });

      const result = evaluateGate({ viewports: [justOver], baselineByLabel });

      expect(result.pass).toBe(false);
    });

    it('fails on negative-direction drift beyond 5% (actual narrower than baseline)', async () => {
      const { evaluateGate } = await loadGateDecision();
      const narrower = viewportResult({ scrollWidth: 1440 * 0.9 });

      const result = evaluateGate({ viewports: [narrower], baselineByLabel });

      expect(result.pass).toBe(false);
    });

    it('a zero baseline requires an exact zero actual', async () => {
      const { withinTolerance } = await loadGateDecision();

      expect(withinTolerance(0, 0)).toBe(true);
      expect(withinTolerance(1, 0)).toBe(false);
    });
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

  // F2: an empty/misconfigured viewport list must never read as a pass --
  // `Array.prototype.every` is vacuously true over `[]`.
  it('(F2) fails closed when zero viewports were verified', async () => {
    const { evaluateGate } = await loadGateDecision();

    const result = evaluateGate({ viewports: [], baselineByLabel });

    expect(result.pass).toBe(false);
  });

  // F2: a baseline document WAS supplied (so this is not the "no --baseline"
  // path), but it has no entry for this exact viewport label -- must fail,
  // not silently run the resource-only check as if no baseline existed.
  it('(F2) fails when a baseline was supplied but has no entry for the checked viewport', async () => {
    const { evaluateGate } = await loadGateDecision();

    const result = evaluateGate({
      viewports: [viewportResult({ label: '768' })],
      baselineByLabel, // only has a '1440' entry
    });

    expect(result.pass).toBe(false);
  });

  // F4: the scroll-animation clamp deliberately makes a clamped mirror's
  // scrollWidth DIFFERENT from the raw live-page baseline (that is the fix
  // working -- see clamp-scroll-animation-overflow.mjs). mirror-site.mjs
  // records a re-measured `expectedScrollWidth` on the baseline entry when
  // it applied the clamp; when present, the gate must check against THAT
  // value instead of the raw (pre-clamp, inflated) baseline.scrollWidth.
  describe('(F4) clamp vs. baseline contract', () => {
    it('a clamped mirror passes: raw baseline is wildly different, but actual matches expectedScrollWidth', async () => {
      const { evaluateGate } = await loadGateDecision();
      const clampedBaseline: Record<string, Baseline> = {
        '1440': {
          // Real designbybrandin.com regression: live/unclamped baseline
          // reads ~6025px; the clamped local mirror measures ~1441px.
          scrollWidth: 6025,
          expectedScrollWidth: 1441,
          scrollHeight: 3000,
          frameworks: { lenis: true, three: false },
          canvasCount: 2,
          imageCount: 5,
          videoCount: 1,
        },
      };
      const clampedClone = viewportResult({ scrollWidth: 1441 });

      const result = evaluateGate({ viewports: [clampedClone], baselineByLabel: clampedBaseline });

      expect(result.pass).toBe(true);
      expect(result.checks[0]?.scrollWidth).toMatchObject({ baseline: 1441, pass: true, source: 'post-clamp-expected' });
    });

    it('a genuinely-broken wide mirror with NO clamp metadata still fails', async () => {
      const { evaluateGate } = await loadGateDecision();
      // No `expectedScrollWidth` on this baseline entry -- nothing was
      // clamped for this site, so a mirror that is simply wide/broken must
      // still be checked against (and fail against) the raw baseline.
      const unclampedBaseline: Record<string, Baseline> = {
        '1440': {
          scrollWidth: 1440,
          scrollHeight: 3000,
          frameworks: { lenis: true, three: false },
          canvasCount: 2,
          imageCount: 5,
          videoCount: 1,
        },
      };
      const brokenClone = viewportResult({ scrollWidth: 6025 });

      const result = evaluateGate({ viewports: [brokenClone], baselineByLabel: unclampedBaseline });

      expect(result.pass).toBe(false);
      expect(result.checks[0]?.scrollWidth).toMatchObject({ baseline: 1440, pass: false, source: 'live-baseline' });
    });
  });
});

describe('validateBaselineDocument (F2: fail-closed baseline validation)', () => {
  const requiredLabels = ['1440', '768', '390'];

  it('accepts a complete, well-formed baseline covering every required viewport', async () => {
    const { validateBaselineDocument } = await loadGateDecision();

    const result = validateBaselineDocument(validBaselineDoc(), requiredLabels);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.baselineByLabel).sort()).toEqual(requiredLabels.sort());
    }
  });

  it('fails closed on an empty metrics array', async () => {
    const { validateBaselineDocument } = await loadGateDecision();

    const result = validateBaselineDocument({ origin: 'https://example.com', metrics: [] }, requiredLabels);

    expect(result.ok).toBe(false);
  });

  it('fails closed when metrics is missing entirely', async () => {
    const { validateBaselineDocument } = await loadGateDecision();

    const result = validateBaselineDocument({ origin: 'https://example.com' }, requiredLabels);

    expect(result.ok).toBe(false);
  });

  it('fails closed on a non-object document (e.g. a JSON array or null)', async () => {
    const { validateBaselineDocument } = await loadGateDecision();

    expect(validateBaselineDocument([], requiredLabels).ok).toBe(false);
    expect(validateBaselineDocument(null, requiredLabels).ok).toBe(false);
  });

  it('fails closed when a metric is missing viewport.label', async () => {
    const { validateBaselineDocument } = await loadGateDecision();

    const doc = validBaselineDoc({
      metrics: [{ ...completeMetric('1440'), viewport: { width: 1440, height: 900, dpr: 1 } }],
    });

    expect(validateBaselineDocument(doc, requiredLabels).ok).toBe(false);
  });

  it('fails closed on a duplicate viewport label', async () => {
    const { validateBaselineDocument } = await loadGateDecision();

    const doc = validBaselineDoc({
      metrics: [completeMetric('1440'), completeMetric('1440')],
    });

    expect(validateBaselineDocument(doc, requiredLabels).ok).toBe(false);
  });

  it('fails closed on a non-finite required numeric field', async () => {
    const { validateBaselineDocument } = await loadGateDecision();

    const doc = validBaselineDoc({
      metrics: [completeMetric('1440', { scrollWidth: Number.NaN })],
    });

    expect(validateBaselineDocument(doc, requiredLabels).ok).toBe(false);
  });

  // F2's exact named scenario: a baseline that only covers 1440 must not
  // silently verify just that one viewport while 768/390 skip all baseline
  // checks.
  it('fails closed when a required viewport label is entirely missing from the baseline', async () => {
    const { validateBaselineDocument } = await loadGateDecision();

    const doc = validBaselineDoc({ metrics: [completeMetric('1440')] });

    const result = validateBaselineDocument(doc, requiredLabels);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/768/);
  });

  it('without requiredLabels, a partial-but-internally-valid baseline is accepted', async () => {
    const { validateBaselineDocument } = await loadGateDecision();

    const doc = validBaselineDoc({ metrics: [completeMetric('1440')] });

    expect(validateBaselineDocument(doc).ok).toBe(true);
  });

  // F2 (round-3): checking only scroll dimensions let a baseline missing
  // origin/frameworks/every count field validate as ok:true, silently
  // disabling the origin-leak, runtime-global, and count gates for the
  // whole run. These three cases pin that each of those sections is now
  // actually required.
  it('(F2) fails closed when top-level origin is missing (disables the origin-leak gate otherwise)', async () => {
    const { validateBaselineDocument } = await loadGateDecision();

    const doc = validBaselineDoc({ origin: undefined });

    expect(validateBaselineDocument(doc, requiredLabels).ok).toBe(false);
  });

  it('(F2) fails closed when top-level origin is an empty string', async () => {
    const { validateBaselineDocument } = await loadGateDecision();

    const doc = validBaselineDoc({ origin: '' });

    expect(validateBaselineDocument(doc, requiredLabels).ok).toBe(false);
  });

  // All three required labels stay present here -- only the field under test
  // is broken. Dropping to a single metric (as an earlier draft of this test
  // did) would ALSO fail the pre-existing requiredLabels check, which passes
  // even against the round-2 (pre-fix) validator and would make this test a
  // false-positive red: it would report "ok:false" whether or not the
  // frameworks/count check under test actually ran.
  it('(F2) fails closed when a metric is missing its frameworks object', async () => {
    const { validateBaselineDocument } = await loadGateDecision();

    const doc = validBaselineDoc({
      metrics: [
        completeMetric('1440', { frameworks: undefined }),
        completeMetric('768', { viewport: { label: '768', width: 768, height: 900, dpr: 1 }, scrollWidth: 768, scrollHeight: 3200 }),
        completeMetric('390', { viewport: { label: '390', width: 390, height: 844, dpr: 2 }, scrollWidth: 390, scrollHeight: 3400 }),
      ],
    });

    expect(validateBaselineDocument(doc, requiredLabels).ok).toBe(false);
  });

  it('(F2) fails closed when a metric is missing a count field (canvasCount)', async () => {
    const { validateBaselineDocument } = await loadGateDecision();

    const doc = validBaselineDoc({
      metrics: [
        completeMetric('1440', { canvasCount: undefined }),
        completeMetric('768', { viewport: { label: '768', width: 768, height: 900, dpr: 1 }, scrollWidth: 768, scrollHeight: 3200 }),
        completeMetric('390', { viewport: { label: '390', width: 390, height: 844, dpr: 2 }, scrollWidth: 390, scrollHeight: 3400 }),
      ],
    });

    expect(validateBaselineDocument(doc, requiredLabels).ok).toBe(false);
  });
});

// --- Class-A close-out (wave W-C, criteria CC-3/CC-4/CC-5) ---
describe('(A2) origin-leak detection is independent of response status', () => {
  it('(A2/CC-3) routes a FAILED request to the original origin into originLeaks, not the ignored cross-origin bucket', async () => {
    const requestClassification = (await import(
      pathToFileURL(path.join(repoRoot, 'skills', 'web-clone', 'scripts', 'lib', 'request-classification.mjs')).href
    )) as {
      classifyRequestOrigin: (url: string, ctx: { localBase: string; originalOrigin?: string | null }) => string;
      bucketForRequestIssue?: (kind: string) => string;
    };
    // The routing decision verify-mirror.mjs applies to page.on('requestfailed')
    // must live in a pure, testable function -- and it must send an
    // origin-leak-classified URL to originLeaks REGARDLESS of whether the
    // origin answered. Self-containment is about where the mirror points,
    // not whether the live origin happened to be up during verification.
    expect(typeof requestClassification.bucketForRequestIssue).toBe('function');
    const kind = requestClassification.classifyRequestOrigin('https://example.com/app.js', {
      localBase: 'http://127.0.0.1:4173',
      originalOrigin: 'https://example.com',
    });
    expect(kind).toBe('origin-leak');
    expect(requestClassification.bucketForRequestIssue!(kind)).toBe('originLeaks');
  });

  it('(A2/CC-4 negative control) an unrelated third-party failure stays out of the origin-leak bucket', async () => {
    const requestClassification = (await import(
      pathToFileURL(path.join(repoRoot, 'skills', 'web-clone', 'scripts', 'lib', 'request-classification.mjs')).href
    )) as {
      classifyRequestOrigin: (url: string, ctx: { localBase: string; originalOrigin?: string | null }) => string;
      bucketForRequestIssue?: (kind: string) => string;
    };
    expect(typeof requestClassification.bucketForRequestIssue).toBe('function');
    const kind = requestClassification.classifyRequestOrigin('https://cdn.unrelated.net/lib.js', {
      localBase: 'http://127.0.0.1:4173',
      originalOrigin: 'https://example.com',
    });
    expect(kind).toBe('cross-origin');
    expect(requestClassification.bucketForRequestIssue!(kind)).toBe('crossOriginFailures');
    // And a local failure still lands where the same-origin gate reads it.
    expect(requestClassification.bucketForRequestIssue!('local')).toBe('sameOriginFailures');
  });

  it('(A2) an origin-leak entry recorded from a failed request (error, no status) still fails evaluateGate', async () => {
    const { evaluateGate } = await loadGateDecision();

    const gate = evaluateGate({
      viewports: [
        viewportResult({
          originLeaks: [{ url: 'https://example.com/app.js', error: 'net::ERR_CONNECTION_REFUSED' }],
        }),
      ],
      baselineByLabel,
    });

    expect(gate.pass).toBe(false);
  });
});

describe('(A3/CC-5) malformed baselines fail closed with named diagnostics', () => {
  const requiredLabels = ['1440', '768', '390'];

  it('(A3) rejects an origin that is not an absolute http(s) URL', async () => {
    const { validateBaselineDocument } = await loadGateDecision();

    const result = validateBaselineDocument(validBaselineDoc({ origin: 'not a url' }), requiredLabels);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/http/i);
  });

  it('(A3) rejects a non-http(s) scheme origin (nothing a browser request could leak back to)', async () => {
    const { validateBaselineDocument } = await loadGateDecision();

    const result = validateBaselineDocument(validBaselineDoc({ origin: 'file:///tmp/site' }), requiredLabels);

    expect(result.ok).toBe(false);
  });

  it('(A3) rejects an empty frameworks object (the writer always records the runtime-global flags)', async () => {
    const { validateBaselineDocument } = await loadGateDecision();

    const result = validateBaselineDocument(
      validBaselineDoc({ metrics: [completeMetric('1440', { frameworks: {} })] }),
      ['1440'],
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/frameworks/i);
  });

  it('(A3) rejects non-boolean frameworks values (schema drift, not writer output)', async () => {
    const { validateBaselineDocument } = await loadGateDecision();

    const result = validateBaselineDocument(
      validBaselineDoc({ metrics: [completeMetric('1440', { frameworks: { lenis: 'yes' } })] }),
      ['1440'],
    );

    expect(result.ok).toBe(false);
  });
});
