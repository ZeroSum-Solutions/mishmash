#!/usr/bin/env node
// gate-decision.mjs -- the pure pass/fail rules behind verify-mirror.mjs, the
// mandatory gate a mirror must clear before it may be reported complete or
// served to the user.
//
// Today's incident shipped a half-done designbybrandin.com mirror because
// nothing stopped a stalled capture from being reported as done. The rescue
// that recovered it (RECON-v2/gate.mjs) served the mirror locally, headless-
// loaded it at each captured viewport, and required: zero same-origin
// failed/404 requests, zero broken images, scrollWidth/scrollHeight within 5%
// of the original capture, and the same runtime globals (window.Lenis,
// window.THREE, ...) and canvas/image/video counts the original had. This
// module is that decision, generalized: given already-collected per-viewport
// data (from a live headless run) and an optional capture-time baseline, it
// decides pass/fail. No fs/network/browser dependency, so the classification
// itself is unit-testable without Playwright (not a workspace dependency in
// this repo) -- see verify-mirror.mjs for the I/O that assembles the
// `viewports` input by actually serving and loading the mirror.

export const DEFAULT_TOLERANCE = 0.05;

/** True when `actual` is within `tolerance` (fractional, default 5%) of `expected`. */
export function withinTolerance(actual, expected, tolerance = DEFAULT_TOLERANCE) {
  if (expected === 0) return actual === 0;
  return Math.abs(actual - expected) / Math.abs(expected) <= tolerance;
}

/** Runtime globals the baseline recorded as present (`true`) that the clone did not reproduce. */
function missingRuntimeGlobals(baselineFrameworks, cloneFrameworks) {
  const baseline = baselineFrameworks ?? {};
  const clone = cloneFrameworks ?? {};
  return Object.entries(baseline)
    .filter(([, present]) => present === true)
    .filter(([name]) => clone[name] !== true)
    .map(([name]) => name);
}

const COUNT_KEYS = ["canvasCount", "imageCount", "videoCount"];

/** Baseline-recorded counts (canvas/image/video) the clone does not match exactly. */
function countChecks(baseline, clone) {
  const checks = {};
  for (const key of COUNT_KEYS) {
    if (typeof baseline?.[key] !== "number") continue;
    checks[key] = { baseline: baseline[key], actual: clone[key], pass: clone[key] === baseline[key] };
  }
  return checks;
}

/**
 * Decides pass/fail for one viewport's already-collected data against an
 * optional baseline. Always gated regardless of baseline: zero same-origin
 * resource failures, zero broken images. Only gated when a baseline is
 * supplied: scrollWidth/scrollHeight drift, missing baseline-true runtime
 * globals, and baseline-recorded canvas/image/video counts.
 */
function evaluateViewport(viewport, baseline, tolerance) {
  const sameOriginFailures = viewport.sameOriginFailures ?? [];
  const brokenImages = viewport.brokenImages ?? [];

  const checks = {
    label: viewport.label,
    sameOriginFailures: {
      count: sameOriginFailures.length,
      pass: sameOriginFailures.length === 0,
      items: sameOriginFailures,
    },
    brokenImages: {
      count: brokenImages.length,
      pass: brokenImages.length === 0,
      items: brokenImages,
    },
  };

  const passFlags = [checks.sameOriginFailures.pass, checks.brokenImages.pass];

  if (baseline) {
    checks.scrollWidth = {
      baseline: baseline.scrollWidth,
      actual: viewport.scrollWidth,
      pass: withinTolerance(viewport.scrollWidth, baseline.scrollWidth, tolerance),
    };
    checks.scrollHeight = {
      baseline: baseline.scrollHeight,
      actual: viewport.scrollHeight,
      pass: withinTolerance(viewport.scrollHeight, baseline.scrollHeight, tolerance),
    };
    const missingGlobals = missingRuntimeGlobals(baseline.frameworks, viewport.frameworks);
    checks.runtimeGlobals = { missing: missingGlobals, pass: missingGlobals.length === 0 };
    checks.counts = countChecks(baseline, viewport);

    passFlags.push(
      checks.scrollWidth.pass,
      checks.scrollHeight.pass,
      checks.runtimeGlobals.pass,
      ...Object.values(checks.counts).map((c) => c.pass),
    );
  }

  checks.pass = passFlags.every(Boolean);
  return checks;
}

/**
 * Evaluates the full gate across every captured viewport.
 *
 * @param {object} input
 * @param {Array<object>} input.viewports - per-viewport collected data: `label`,
 *   `sameOriginFailures` (array), `brokenImages` (array), and -- only checked
 *   when a baseline is supplied -- `scrollWidth`, `scrollHeight`,
 *   `frameworks` (a name->boolean map), `canvasCount`, `imageCount`, `videoCount`.
 * @param {Record<string, object>|null} [input.baselineByLabel] - capture-time
 *   baseline metrics keyed by viewport label, or null/undefined to run a
 *   resource/broken-image-only check (no drift/globals/counts gating).
 * @param {number} [input.tolerance] - fractional drift tolerance for
 *   scrollWidth/scrollHeight (default 5%).
 */
export function evaluateGate({ viewports, baselineByLabel = null, tolerance = DEFAULT_TOLERANCE }) {
  const checks = viewports.map((viewport) =>
    evaluateViewport(viewport, baselineByLabel ? baselineByLabel[viewport.label] : null, tolerance),
  );

  return {
    pass: checks.every((check) => check.pass),
    baselineProvided: Boolean(baselineByLabel),
    checks,
  };
}
