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
const REQUIRED_NUMERIC_FIELDS = ["scrollWidth", "scrollHeight", "canvasCount", "imageCount", "videoCount"];
// The runtime-global flags lib/viewport-capture.mjs's collectRuntimeMetrics
// ALWAYS writes -- validation requires exactly these (extra keys from a
// future writer are tolerated; a missing one means "not writer output").
const REQUIRED_FRAMEWORK_KEYS = ["three", "gsap", "lenis"];

/** True when `actual` is within `tolerance` (fractional, default 5%) of `expected`. */
export function withinTolerance(actual, expected, tolerance = DEFAULT_TOLERANCE) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  if (expected === 0) return actual === 0;
  return Math.abs(actual - expected) / Math.abs(expected) <= tolerance;
}

/**
 * Validates a parsed `mirror-baseline-metrics.json` document before it is
 * trusted for gating. Fails closed on: not an object, a missing/empty
 * top-level `origin`, `metrics` missing/empty/not an array, a metric missing
 * a `viewport.label`, a duplicate label, a missing/non-object `frameworks`,
 * a non-finite required numeric field (scroll dimensions AND the
 * canvas/image/video counts -- checking scroll dimensions alone let a
 * baseline missing `origin`/`frameworks`/every count field validate as
 * `ok:true`, silently disabling the origin-leak, runtime-global, and count
 * gates for the whole run), or (when `requiredLabels` is given) a label the
 * document doesn't cover at all -- e.g. a baseline that only captured 1440
 * would otherwise silently verify just that one viewport while 768/390 pass
 * with no baseline checks ever run against them.
 *
 * @param {unknown} baselineDoc - `JSON.parse`d baseline file contents.
 * @param {string[]} [requiredLabels] - viewport labels that must all be present.
 * @returns {{ ok: true, baselineByLabel: Record<string, object> } | { ok: false, error: string }}
 */
export function validateBaselineDocument(baselineDoc, requiredLabels = []) {
  if (!baselineDoc || typeof baselineDoc !== "object" || Array.isArray(baselineDoc)) {
    return { ok: false, error: "baseline must be a JSON object" };
  }
  // A3: "non-empty string" let `origin: "not a url"` through, and a
  // non-URL origin silently disables the origin-leak gate for the whole run
  // (classifyRequestOrigin can never match a host against it). The writer
  // records `new URL(args.url).origin` -- always an absolute http(s) URL --
  // so anything else is not writer output and must fail closed.
  if (typeof baselineDoc.origin !== "string" || baselineDoc.origin.length === 0) {
    return { ok: false, error: "baseline.origin must be a non-empty string (needed for the origin-leak gate)" };
  }
  let originUrl = null;
  try {
    originUrl = new URL(baselineDoc.origin);
  } catch {
    originUrl = null;
  }
  if (!originUrl || (originUrl.protocol !== "http:" && originUrl.protocol !== "https:")) {
    return {
      ok: false,
      error: `baseline.origin must be an absolute http(s) URL, got ${JSON.stringify(baselineDoc.origin)} (a non-URL origin silently disables the origin-leak gate)`,
    };
  }
  if (!Array.isArray(baselineDoc.metrics) || baselineDoc.metrics.length === 0) {
    return { ok: false, error: "baseline.metrics must be a non-empty array" };
  }

  const byLabel = new Map();
  for (const [index, metric] of baselineDoc.metrics.entries()) {
    const label = metric?.viewport?.label;
    if (typeof label !== "string" || label.length === 0) {
      return { ok: false, error: `baseline.metrics[${index}] is missing a viewport.label` };
    }
    if (byLabel.has(label)) {
      return { ok: false, error: `baseline.metrics contains a duplicate viewport label "${label}"` };
    }
    if (typeof metric.frameworks !== "object" || metric.frameworks === null || Array.isArray(metric.frameworks)) {
      return { ok: false, error: `baseline.metrics[${index}] (viewport "${label}") is missing a frameworks object` };
    }
    // A3: the writer (lib/viewport-capture.mjs's collectRuntimeMetrics)
    // always records the full runtime-global flag set as booleans -- the
    // EXACT keys below, kept in lockstep with that function (both files
    // ship together, so drift is a bug, not a compatibility concern). A
    // baseline missing any writer key was not produced by the writer, and
    // accepting merely "some boolean object" (`{react:false}`) would
    // silently disable every intended runtime-global check.
    const missingFrameworkKeys = REQUIRED_FRAMEWORK_KEYS.filter((key) => !(key in metric.frameworks));
    if (missingFrameworkKeys.length) {
      return {
        ok: false,
        error: `baseline.metrics[${index}] (viewport "${label}") frameworks is missing writer key(s) ${missingFrameworkKeys.join(", ")} -- not collectRuntimeMetrics output`,
      };
    }
    const nonBoolean = Object.entries(metric.frameworks).find(([, present]) => typeof present !== "boolean");
    if (nonBoolean) {
      return {
        ok: false,
        error: `baseline.metrics[${index}] (viewport "${label}") frameworks.${nonBoolean[0]} must be a boolean, got ${JSON.stringify(nonBoolean[1])}`,
      };
    }
    for (const field of REQUIRED_NUMERIC_FIELDS) {
      if (!Number.isFinite(metric[field])) {
        return { ok: false, error: `baseline.metrics[${index}] (viewport "${label}") has a non-finite ${field}` };
      }
    }
    byLabel.set(label, metric);
  }

  if (requiredLabels.length) {
    const missing = requiredLabels.filter((label) => !byLabel.has(label));
    if (missing.length) {
      return { ok: false, error: `baseline is missing required viewport(s): ${missing.join(", ")}` };
    }
  }

  return { ok: true, baselineByLabel: Object.fromEntries(byLabel) };
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
 * resource failures, zero broken images, zero requests that leaked back to
 * the mirror's original live origin (see `originLeaks` on `evaluateGate`).
 * Only gated when a baseline is supplied: scrollWidth/scrollHeight drift,
 * missing baseline-true runtime globals, and baseline-recorded canvas/image/
 * video counts.
 *
 * `baselineProvidedOverall` distinguishes "no baseline was supplied at all"
 * (drift/globals/counts skipped, as documented) from "a baseline WAS
 * supplied but has no entry for this specific viewport" (a mismatch that
 * must fail, not silently skip -- `validateBaselineDocument`'s
 * `requiredLabels` check is supposed to prevent this upstream, but a caller
 * that skips validation must not get a silent pass here as a result).
 */
function evaluateViewport(viewport, baseline, tolerance, baselineProvidedOverall) {
  const sameOriginFailures = viewport.sameOriginFailures ?? [];
  const brokenImages = viewport.brokenImages ?? [];
  const originLeaks = viewport.originLeaks ?? [];

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
    originLeaks: {
      count: originLeaks.length,
      pass: originLeaks.length === 0,
      items: originLeaks,
    },
  };

  const passFlags = [checks.sameOriginFailures.pass, checks.brokenImages.pass, checks.originLeaks.pass];

  if (baselineProvidedOverall && !baseline) {
    // A baseline document was supplied, but this exact viewport has no
    // matching entry -- fail rather than silently running the no-baseline
    // (resource-only) check, which would look identical to "everything
    // passed" in the summary.
    checks.baselineMismatch = { pass: false, reason: "no baseline entry for this viewport" };
    passFlags.push(false);
  } else if (baseline) {
    // F4 (clamp vs. baseline conflict): mirror-site.mjs's scroll-animation-
    // overflow clamp deliberately makes the mirror's scrollWidth DIFFERENT
    // from the raw live-page baseline for sites that need it -- that is the
    // fix working, not drift. When mirror-site.mjs applied that clamp, it
    // re-measures the clamped local mirror once at capture time and records
    // that measurement as `expectedScrollWidth` on the baseline entry. When
    // present, the gate checks the clone against THAT post-transform
    // expectation instead of the raw (pre-clamp, inflated) baseline
    // scrollWidth. When absent (no clamp applied), behavior is unchanged: a
    // genuinely wide/broken mirror is still checked against, and still
    // fails against, the raw baseline. scrollHeight is never affected by the
    // clamp (it only clips horizontal overflow), so it always checks
    // against the raw baseline value.
    const scrollWidthExpected = Number.isFinite(baseline.expectedScrollWidth)
      ? baseline.expectedScrollWidth
      : baseline.scrollWidth;
    checks.scrollWidth = {
      baseline: scrollWidthExpected,
      actual: viewport.scrollWidth,
      pass: withinTolerance(viewport.scrollWidth, scrollWidthExpected, tolerance),
      source: Number.isFinite(baseline.expectedScrollWidth) ? "post-clamp-expected" : "live-baseline",
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
 *   `sameOriginFailures` (array), `brokenImages` (array), `originLeaks`
 *   (array -- requests that resolved against the mirror's original live
 *   origin instead of the served local mirror), and -- only checked when a
 *   baseline is supplied -- `scrollWidth`, `scrollHeight`, `frameworks` (a
 *   name->boolean map), `canvasCount`, `imageCount`, `videoCount`.
 * @param {Record<string, object>|null} [input.baselineByLabel] - capture-time
 *   baseline metrics keyed by viewport label (normally the output of
 *   `validateBaselineDocument`), or null/undefined to run a resource/broken-
 *   image/origin-leak-only check (no drift/globals/counts gating).
 * @param {number} [input.tolerance] - fractional drift tolerance for
 *   scrollWidth/scrollHeight (default 5%).
 */
export function evaluateGate({ viewports, baselineByLabel = null, tolerance = DEFAULT_TOLERANCE }) {
  if (!Array.isArray(viewports) || viewports.length === 0) {
    // Zero viewports must never read as a pass -- `Array.prototype.every`
    // is vacuously true over an empty array, which would otherwise let an
    // empty/misconfigured verification run report success.
    return { pass: false, baselineProvided: Boolean(baselineByLabel), checks: [], error: "no viewports were verified" };
  }

  const baselineProvidedOverall = Boolean(baselineByLabel);
  const checks = viewports.map((viewport) =>
    evaluateViewport(viewport, baselineByLabel ? baselineByLabel[viewport.label] : null, tolerance, baselineProvidedOverall),
  );

  return {
    pass: checks.every((check) => check.pass),
    baselineProvided: baselineProvidedOverall,
    checks,
  };
}
