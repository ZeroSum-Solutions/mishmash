// Rendered layout-risk measurement contract.
//
// Why this exists: `craft/composition.md`'s `layout-risk-flat` lint
// (`apps/daemon/src/lint-artifact.ts`) can only grep source HTML for the CSS
// primitives a grid-breaking move WOULD need (`position` + `z-index`, or a
// `transform`), not whether one actually rendered. A page can carry a single
// `position: sticky` nav and satisfy the source scan while never once
// breaking its grid — a false negative the lint's own author anticipated
// (the check is deliberately one-directional: absence only, never presence).
// Four rounds of blind comparison against professionally sold templates
// scored MishMash output 0/1 on layout risk every time regardless.
//
// The fix has to live where the page is actually laid out: the preview
// iframe, via `getComputedStyle`/`getBoundingClientRect` on the rendered
// DOM (see `injectCompositionMetricsBridge` in
// `apps/web/src/runtime/srcdoc.ts`). The daemon cannot take this
// measurement itself — it has no browser in its runtime dependencies, and
// Playwright stays a dev/e2e-only dependency, never a daemon one (AGENTS.md
// "Daemon data directory contract" / Design authority boundaries) — so the
// measurement is taken in the browser and REPORTED to the daemon, not
// computed by it. `POST /api/composition-metrics` is how the web host
// files a measurement after the bridge posts it; `GET /api/composition-
// metrics` is how both the web UI and `od composition-metrics` read the
// last one back. A run with no preview ever opened (a headless `od run`)
// has nothing to report and nothing to read — that gap is real, not
// papered over.
//
// This is deliberately NOT a score. AGENTS.md's "Design authority" section
// forbids this repository having a taste of its own; a numeric grade would
// be exactly that. Every field below is a raw, reader-interpreted count —
// "3 sections, 1 out-of-flow element" — never a verdict.

/**
 * One rendered-page measurement, computed entirely from `getComputedStyle`
 * (and, for the two geometry fields, `getBoundingClientRect`) on the live
 * preview DOM — see the bridge's own comment for exactly how each field is
 * derived and why it's the honest proxy available without a real layout
 * engine in the daemon.
 */
export interface CompositionMetrics {
  /** Total `<section>` elements in the rendered document. */
  sectionCount: number;
  /**
   * Elements at rest (not just on `:hover`/`:focus`) whose computed
   * `position` is `absolute`, `fixed`, or `sticky` AND whose computed
   * `z-index` is not `auto` — the exact pair `layout-risk-flat` greps
   * source for, measured here on the rendered box tree instead. Excludes
   * an element whose own computed `display` is `none` or `visibility` is
   * `hidden` — a closed modal/lightbox/drawer renders nothing, so it
   * cannot be evidence of a move a viewer would ever see.
   */
  outOfFlowElementCount: number;
  /**
   * Elements at rest whose computed `transform` is not `none`. A
   * hover/focus-only transform never appears here, because it is measured
   * on the DOM's resting state, not a simulated pseudo-class. Excludes
   * hidden elements for the same reason as `outOfFlowElementCount`.
   */
  transformedElementCount: number;
  /** Distinct `getComputedStyle(section).backgroundColor` values across every `<section>`. */
  distinctSectionBackgroundCount: number;
  /**
   * Distinct rendered `<section>` widths (via `getBoundingClientRect`,
   * rounded to suppress subpixel noise). 1 means every section is the
   * same width — the "equal-margin grid" shape the evidence names.
   */
  distinctSectionWidthCount: number;
  /**
   * True when at least one `<section>` spans (within a few px of) the
   * viewport width AND at least one other section is narrower than it —
   * i.e. a full-bleed band sits next to a contained one.
   */
  fullBleedAgainstContained: boolean;
  /** `getComputedStyle(document.body).fontSize`, in px. */
  bodyFontSizePx: number;
  /** The largest computed `font-size`, in px, across every element scanned. */
  maxDisplayFontSizePx: number;
  /** `maxDisplayFontSizePx / bodyFontSizePx`, or `0` when `bodyFontSizePx` is `0`. */
  displayToBodyFontRatio: number;
  /** ISO-8601 timestamp of when the browser computed this measurement. */
  measuredAt: string;
}

/**
 * Body the web host posts after the preview bridge reports a measurement.
 * `projectId` + `file` identify what was measured; `metrics` is the bridge's
 * raw output, unmodified.
 */
export interface ReportCompositionMetricsRequest {
  projectId: string;
  /** Path of the measured file, relative to the project root. */
  file: string;
  metrics: CompositionMetrics;
}

/**
 * One stored measurement. `isWebCloneRun` is resolved server-side from the
 * project's own `metadata.intent` (never trusted from the client) — the
 * same signal `lintArtifact`'s `isWebCloneRun` option and `craft.ts`'s
 * `resolveRequestedCraft` already key their own exemptions on. A clone
 * reproducing a uniform target is not a defect, so a reader (UI or CLI)
 * showing this record must not frame it as one for a clone run.
 */
export interface CompositionMetricsRecord {
  projectId: string;
  file: string;
  metrics: CompositionMetrics;
  isWebCloneRun: boolean;
  /** ISO-8601 timestamp of when the daemon stored this record. */
  reportedAt: string;
}

export interface ReportCompositionMetricsResponse {
  ok: true;
  record: CompositionMetricsRecord;
}

/**
 * `GET /api/composition-metrics` accepts either an explicit
 * `projectId`+`file` pair, or a single `artifactPath` (absolute, under the
 * daemon's managed project root) that the daemon resolves into the same
 * pair server-side — the CLI's "take an artifact path or project id"
 * entry point.
 */
export interface GetCompositionMetricsQuery {
  projectId?: string;
  file?: string;
  artifactPath?: string;
}

export interface GetCompositionMetricsResponse {
  ok: true;
  /** `null` when nothing has been reported for this artifact yet. */
  record: CompositionMetricsRecord | null;
}
