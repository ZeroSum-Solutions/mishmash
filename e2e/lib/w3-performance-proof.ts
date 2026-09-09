// W3 endpoint-latency proof — the schema one pinned 24 h capture is written in,
// the validator that refuses a capture which cannot support the Wave 3 bar, and
// the report that judges INV-3.1 and INV-3.10 from it.
//
// This is PROOF material, not a product wire. Nothing in the daemon or the web
// app reads these types; the capture is produced by `w3-performance-capture.ts`
// from a daemon request-timing log plus a `ui-lag` export of `GET /api/anomalies`,
// and written to `proof/w3/endpoint-latency-24h.json`.
//
// Why a validator at all: a latency claim is only as good as the capture behind
// it, and every cheap way to make a bar go green is a property of the capture
// rather than of the product — drop the failures, shorten the window, judge a
// route on four samples, group two routes into one row, time the browser
// instead of the daemon. `validateProof` names each of those and refuses the
// capture, so a PASS report can only come from a capture that could have failed.

import { summarizeSamples } from './playwright/page-load-benchmark.js';

/** The pinned capture is exactly this long (DEF-3.1). */
export const W3_WINDOW_MS = 24 * 60 * 60 * 1_000;

/** Fewer successful observations than this and a route is not judged, it is INSUFFICIENT (DEF-3.1, A2). */
export const W3_MIN_SUCCESSFUL_SAMPLES = 30;

/** INV-3.1: a route's p95 must be strictly below this. */
export const W3_ROUTE_P95_BUDGET_MS = 2_000;

/** DEF-3.2: a `ui-lag` record counts as a long task above this duration. */
export const W3_UI_LAG_THRESHOLD_MS = 1_000;

/** INV-3.10: fewer than this many long tasks in the pinned interval. */
export const W3_UI_LAG_MAX_PER_WINDOW = 10;

/**
 * How an observation ended. A closed set on purpose: an outcome outside it is
 * how a capture smuggles a failure past the reader as something else, so the
 * validator refuses the whole capture rather than skipping the row.
 */
export type W3SampleOutcome = 'success' | 'client-error' | 'server-error' | 'unreachable';

export const W3_SAMPLE_OUTCOMES: readonly W3SampleOutcome[] = [
  'success',
  'client-error',
  'server-error',
  'unreachable',
];

/**
 * Which side of the wire measured the duration.
 *
 * `daemon` is middleware entry to the request's terminal event. `web` is the browser's own
 * view, which includes per-host connection queueing — with several tabs open a
 * request can sit minutes in the browser's queue while the daemon served it in
 * milliseconds (D-21). Both are recorded; only `daemon` decides INV-3.1.
 */
export type W3TimingSource = 'daemon' | 'web';

export interface W3RequiredRoute {
  method: string;
  /** Already in normalized form — see `normalizeRouteKey`. */
  route: string;
}

/**
 * Every route the bar judges: the PRD §7.2 table with its grouped row expanded
 * into its five members (DEF-3.4) and its SSE row dropped, plus the five routes
 * D-20 added. Each is judged independently; a capture with no row for one of
 * them is refused rather than reported as a smaller table.
 */
export const W3_REQUIRED_ROUTES: readonly W3RequiredRoute[] = [
  // §7.2, in table order. `GET /api/runs/:id/events` is excluded: it is the SSE
  // stream, whose duration measures how long the user kept it open.
  { method: 'PUT', route: '/api/projects/:id/conversations/:cid/messages/:mid' },
  { method: 'GET', route: '/api/projects/:id/files' },
  { method: 'GET', route: '/api/integrations/vela/message-center/messages' },
  { method: 'GET', route: '/api/projects/:id' },
  { method: 'GET', route: '/api/agents' },
  { method: 'GET', route: '/api/live-artifacts' },
  { method: 'GET', route: '/api/design-systems' },
  { method: 'GET', route: '/api/integrations/vela/status' },
  { method: 'GET', route: '/api/projects' },
  // DEF-3.4: the grouped §7.2 row becomes five rows, so one slow member cannot
  // hide inside the group's median.
  { method: 'GET', route: '/api/skills' },
  { method: 'GET', route: '/api/prompt-templates' },
  { method: 'GET', route: '/api/recent-dirs' },
  { method: 'GET', route: '/api/analytics/config' },
  { method: 'GET', route: '/api/media/config' },
  { method: 'POST', route: '/api/projects/:id/upload' },
  // D-20: the busiest slow routes in the live wave-2 window, added to the bar.
  { method: 'GET', route: '/api/skills/:id/assets/*' },
  { method: 'GET', route: '/api/skills/:id/fonts/*' },
  { method: 'GET', route: '/api/connectors' },
  { method: 'GET', route: '/api/connectors/status' },
  { method: 'GET', route: '/api/connectors/discovery' },
];

/**
 * The route-normalization key, in the words the proof file pins (A3).
 *
 * Kept next to `normalizeRouteKey` so the prose a reader is given and the rule
 * the report ran cannot drift apart.
 */
export const W3_ROUTE_NORMALIZATION_KEY = [
  'Method is upper-cased and the query string dropped.',
  "Express 5 splat suffixes ('*splat', '*anything') collapse to '*'.",
  "UUID segments become positional placeholders: the first ':id', the second ':cid', the third ':mid'.",
  "The vela message-center splat route resolves to its concrete '/messages' path.",
  'A trailing slash is dropped.',
].join(' ');

const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_PLACEHOLDERS: readonly string[] = [':id', ':cid', ':mid'];
const MESSAGE_CENTER_PREFIX = '/api/integrations/vela/message-center';

/**
 * Collapses the several spellings one endpoint reaches a capture under into the
 * single row the bar judges.
 *
 * The daemon records the Express pattern when a route matched and the concrete
 * path when none did; the browser only ever knows the concrete path. §7.2 calls
 * the result "two spellings" for the message PUT, and left alone they would be
 * two rows, each below the 30-sample floor, neither judged.
 */
export function normalizeRouteKey(method: string, route: string): string {
  const withoutQuery = route.split('?')[0] ?? route;
  const trimmed = withoutQuery.length > 1 && withoutQuery.endsWith('/')
    ? withoutQuery.slice(0, -1)
    : withoutQuery;
  let seenUuids = 0;
  const segments = trimmed.split('/').map((segment) => {
    if (segment.startsWith('*')) return '*';
    if (!UUID_SEGMENT.test(segment)) return segment;
    const placeholder = UUID_PLACEHOLDERS[seenUuids] ?? ':id';
    seenUuids += 1;
    return placeholder;
  });
  let normalized = segments.join('/');
  // `app.all('/api/integrations/vela/message-center/*splat')` means the daemon
  // labels every message-center call with the splat pattern, so the concrete
  // sub-path the §7.2 table names is the only spelling both sides can share.
  if (normalized === `${MESSAGE_CENTER_PREFIX}/*`) {
    normalized = `${MESSAGE_CENTER_PREFIX}/messages`;
  }
  return `${method.toUpperCase()} ${normalized}`;
}

/** `normalizeRouteKey` applied to a required route, for lookups. */
export function requiredRouteKey(required: W3RequiredRoute): string {
  return normalizeRouteKey(required.method, required.route);
}

export interface W3Interval {
  startUtc: string;
  endUtc: string;
}

export interface W3ProofWindow extends W3Interval {
  /**
   * Every stretch inside the window during which nothing was observing — a
   * daemon restart, a capture the operator paused. Empty means continuous.
   * Declared rather than inferred: a gap is invisible in a list of samples,
   * which is exactly why a censored capture would otherwise read as a quiet one.
   */
  gaps: W3Interval[];
}

export interface W3LatencySample {
  method: string;
  /** Normalized — see `normalizeRouteKey`. */
  route: string;
  durationMs: number;
  atUtc: string;
  outcome: W3SampleOutcome;
  /** HTTP status, or 0 when the request never answered. */
  status: number;
  /** Which capture run produced the row, so two runs cannot be silently blended. */
  sourceRun: string;
  source: W3TimingSource;
  /** True when the observation is one frame of an SSE stream. */
  stream?: boolean;
  /**
   * The typed frame this stream sample carried (`AgentRegistrySseEvent` and
   * friends). A stream sample without one is an untyped frame: nothing proves
   * what the daemon actually sent, so the capture is refused (INV-3.11).
   */
  frameType?: string;
}

export interface W3UiLagSample {
  atUtc: string;
  /** From the anomaly record's `detail.duration_ms`, which is where the web writes it. */
  durationMs: number;
}

/**
 * A stretch of the anomaly log's record sequence that no poll ever read.
 *
 * The long-task half's counterpart to `W3ProofWindow.gaps`: the window had an
 * observer throughout, but the log rotated faster than the capture polled it, so
 * the records numbered in this range left the log unseen. Named by range rather
 * than counted, because "three records went missing" is not actionable and
 * "records 4 to 6 went missing between 11:00 and 12:40" is.
 */
export interface W3SequenceGap {
  /** First anomaly-log sequence the polls never read. */
  fromSeq: number;
  /** Last anomaly-log sequence the polls never read. */
  toSeq: number;
}

/**
 * What the capture SAW on a route, before any row was written.
 *
 * The reason this is separate from `samples`: a capture that drops its failures
 * looks identical to a capture that had none. Recording attempts at the source
 * makes the difference checkable — fewer rows than attempts means rows went
 * missing between observation and file (INV-3.11, A2).
 *
 * What this cross-check does and does not catch, stated plainly so nobody reads
 * more into it than it carries. `readTimingLog` counts an attempt and writes the
 * row from the SAME journaled attempt, so for a capture the shipped script
 * produced the two agree by construction. The check therefore catches rows
 * removed AFTER the capture — a hand-edited proof JSON, a filtered export — and
 * not an observer that never saw the request at all. What closes THAT hole is
 * upstream: the daemon journals the attempt on arrival, so a request it never
 * answered reaches the log as a status-0 row rather than as nothing.
 * A route that declares no attempts at all is refused outright
 * (`missing-route-attempts`): an absent denominator would make the check vacuous,
 * which is the cheapest way around it.
 */
export interface W3RouteAttempts {
  method: string;
  route: string;
  /** Which observer made them. Rows are compared against the attempts of their OWN
   *  observer, so client-observed rows cannot pad a route whose daemon rows went missing. */
  source: W3TimingSource;
  attempts: number;
}

/**
 * What the capture was, pinned so the numbers can be reproduced or disputed (A3).
 * The validator refuses a capture missing any of it.
 */
/**
 * How the capture treated caches. A closed set: cold and warm are different
 * measurements of the same route, so a value nobody defined leaves a reader
 * unable to say which of the two they are holding.
 */
export type W3CachePolicy = 'cold' | 'warm' | 'mixed';

export const W3_CACHE_POLICIES: readonly W3CachePolicy[] = ['cold', 'warm', 'mixed'];

export interface W3CaptureMetadata {
  /** Daemon commit the capture ran against. */
  daemonSha: string;
  /** Machine and runtime the capture ran on. */
  runtimeIdentity: string;
  /** What was being done during the window. */
  workload: string;
  /** Open app tabs, because per-host connection queueing scales with them (D-21). */
  openTabCount: number;
  /** How long a tab was foreground-visible, which is when `longtask` fires at all. */
  foregroundTabExposure: string;
  cachePolicy: W3CachePolicy;
  /** Expected to be `W3_ROUTE_NORMALIZATION_KEY`. */
  normalizationKey: string;
}

export interface W3EndpointLatencyProof {
  window: W3ProofWindow;
  capture: W3CaptureMetadata;
  routeAttempts: W3RouteAttempts[];
  samples: W3LatencySample[];
  uiLag: W3UiLagSample[];
  /**
   * `ui-lag` records in the window that carried no readable duration.
   *
   * Declared rather than dropped. The web always writes `detail.duration_ms`
   * (`apps/web/src/observability/anomaly-report.ts`), so a record without one is
   * itself anomalous — and it is exactly the record that might have been over the
   * bar. A reader that skipped it silently would be censoring the count it
   * reports, which is what this whole module exists to refuse.
   */
  uiLagUnmeasurable: number;
  /**
   * Every `ui-lag` record the capture READ inside the window, measured or not.
   *
   * The long-task half's denominator, and the exact counterpart of
   * `routeAttempts` on the endpoint half. Without it, deleting entries from
   * `uiLag` after the capture is undetectable: the count simply drops, and a
   * capture that failed INV-3.10 reads as one that passed it. With it,
   * `uiLag.length + uiLagUnmeasurable` must equal this number or the capture is
   * refused.
   */
  uiLagRecordsRead: number;
  /**
   * `total` from the ui-lag export's envelope, minus the records it handed over.
   *
   * `GET /api/anomalies` applies its `limit` after matching and reports the
   * matched count as `total` (`apps/daemon/src/anomaly-log.ts`), so an export
   * taken with too small a limit is a page of the answer rather than the answer.
   * Every other long-task check is blind to this: the records that WERE delivered
   * are perfectly self-consistent with each other, `uiLagRecordsRead` counts them
   * honestly, and the count INV-3.10 is judged on is simply smaller than the truth.
   * The envelope is the only place the loss is visible, so the capture reads it
   * there and carries the difference here.
   *
   * Signed, because the invariant is equality rather than "not truncated". A
   * negative value is an envelope that declares fewer records than sit beside it,
   * which is a file whose two halves cannot both be true — refused, not read as
   * zero loss.
   */
  uiLagExportShortfall: number;
  /**
   * Sequence ranges the capture's polls never covered.
   *
   * `uiLagExportShortfall` catches a single export that was a page of its own
   * query. This catches the loss that happens BETWEEN exports: the anomaly log
   * keeps one previous generation, so a window long enough to roll it twice
   * removes records that no single answer was ever asked for. Every export
   * involved is internally consistent, `uiLagRecordsRead` counts what arrived
   * honestly, and the count INV-3.10 is judged on is simply smaller than the
   * truth — the same censoring shape, one level up.
   *
   * Empty means consecutive polls overlapped and the population is whole.
   * Absent must be refused rather than read as empty, for the reason
   * `declaredLoss` states.
   */
  uiLagSequenceGaps: W3SequenceGap[];
  /**
   * Timing-log lines the reader could not parse.
   *
   * The endpoint half's counterpart to `uiLagUnmeasurable`. A daemon killed
   * mid-append leaves a half-written row; the reader drops it from the rows AND
   * from that route's attempts in the same pass, so the capture stays internally
   * consistent while its population quietly shrinks — the one way the endpoint
   * half could still be smaller than what was observed without any check firing.
   */
  unparseableTimingLines: number;
}

export type W3ViolationCode =
  | 'missing-route-row'
  | 'insufficient-samples'
  | 'unknown-outcome'
  | 'dropped-failures'
  | 'missing-route-attempts'
  | 'unmeasurable-ui-lag'
  | 'dropped-ui-lag'
  | 'truncated-ui-lag-export'
  | 'ui-lag-gap'
  | 'unparseable-timing-line'
  | 'window-not-24h'
  | 'window-not-continuous'
  | 'sample-outside-window'
  | 'negative-duration'
  | 'untyped-stream-frame'
  | 'web-only-route'
  | 'missing-capture-metadata';

export interface W3Violation {
  code: W3ViolationCode;
  /** The route key, field name, or sample this is about. */
  subject: string;
  detail: string;
}

const REQUIRED_METADATA_FIELDS: readonly (keyof W3CaptureMetadata)[] = [
  'daemonSha',
  'runtimeIdentity',
  'workload',
  'foregroundTabExposure',
  'cachePolicy',
  'normalizationKey',
];

function parseUtc(value: string): number {
  return Date.parse(value);
}

/**
 * Every reason this capture cannot support the bar, worst first by category.
 *
 * An empty result is the only state in which `reportProof`'s verdict means
 * anything: the report judges the product, this judges the capture.
 */
export function validateProof(proof: W3EndpointLatencyProof): W3Violation[] {
  const violations: W3Violation[] = [];
  violations.push(...validateWindow(proof.window));
  violations.push(...validateMetadata(proof.capture));
  violations.push(...validateSamples(proof));
  violations.push(
    ...declaredLoss({
      code: 'unparseable-timing-line',
      field: 'unparseableTimingLines',
      value: proof.unparseableTimingLines,
      absent: 'the capture does not say how many timing-log lines it could not parse',
      nonZero: (count) =>
        `${count} timing-log line(s) could not be parsed; each was an observation the population lost`,
    }),
  );
  violations.push(...validateUiLag(proof));
  violations.push(...validateRouteCoverage(proof));
  return violations;
}

function validateWindow(window: W3ProofWindow): W3Violation[] {
  const violations: W3Violation[] = [];
  const start = parseUtc(window.startUtc);
  const end = parseUtc(window.endUtc);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== W3_WINDOW_MS) {
    violations.push({
      code: 'window-not-24h',
      subject: `${window.startUtc}..${window.endUtc}`,
      detail: `window must span exactly ${W3_WINDOW_MS} ms; spans ${Number.isFinite(end - start) ? end - start : 'an unparseable interval'}`,
    });
  }
  for (const gap of window.gaps ?? []) {
    violations.push({
      code: 'window-not-continuous',
      subject: `${gap.startUtc}..${gap.endUtc}`,
      detail: 'the capture declares a stretch with no observer; the window is not continuous',
    });
  }
  return violations;
}

function validateMetadata(capture: W3CaptureMetadata): W3Violation[] {
  const violations: W3Violation[] = [];
  for (const field of REQUIRED_METADATA_FIELDS) {
    const value = capture?.[field];
    if (typeof value !== 'string' || value.trim() === '') {
      violations.push({
        code: 'missing-capture-metadata',
        subject: field,
        detail: 'a capture that does not pin how it was taken cannot be reproduced or disputed',
      });
    }
  }
  if (
    typeof capture?.normalizationKey === 'string'
    && capture.normalizationKey.trim() !== ''
    && capture.normalizationKey !== W3_ROUTE_NORMALIZATION_KEY
  ) {
    // A key that names a different rule from the one `normalizeRouteKey` ran is a
    // label nobody can trust: the grouping in the report would not be the grouping
    // the file claims. Refused rather than silently relabelled.
    violations.push({
      code: 'missing-capture-metadata',
      subject: 'normalizationKey',
      detail: 'the pinned normalization key is not the rule this report grouped by',
    });
  }
  if (!W3_CACHE_POLICIES.includes(capture?.cachePolicy)) {
    violations.push({
      code: 'missing-capture-metadata',
      subject: 'cachePolicy',
      detail: `cachePolicy ${JSON.stringify(capture?.cachePolicy)} is outside the closed set ${W3_CACHE_POLICIES.join('|')}`,
    });
  }
  if (!Number.isFinite(capture?.openTabCount) || (capture?.openTabCount ?? -1) < 0) {
    violations.push({
      code: 'missing-capture-metadata',
      subject: 'openTabCount',
      detail: 'per-host connection queueing scales with open tabs, so the count is part of the measurement',
    });
  }
  return violations;
}

function validateSamples(proof: W3EndpointLatencyProof): W3Violation[] {
  const violations: W3Violation[] = [];
  const start = parseUtc(proof.window.startUtc);
  const end = parseUtc(proof.window.endUtc);
  for (const sample of proof.samples) {
    const key = normalizeRouteKey(sample.method, sample.route);
    if (!W3_SAMPLE_OUTCOMES.includes(sample.outcome)) {
      violations.push({
        code: 'unknown-outcome',
        subject: key,
        detail: `outcome ${JSON.stringify(sample.outcome)} is outside the closed set ${W3_SAMPLE_OUTCOMES.join('|')}`,
      });
    }
    if (!Number.isFinite(sample.durationMs) || sample.durationMs < 0) {
      violations.push({
        code: 'negative-duration',
        subject: key,
        detail: `durationMs ${sample.durationMs} is not a non-negative measurement`,
      });
    }
    if (sample.stream === true && (sample.frameType ?? '').trim() === '') {
      violations.push({
        code: 'untyped-stream-frame',
        subject: key,
        detail: 'a stream sample carries no frameType, so nothing pins which typed frame the daemon sent',
      });
    }
    const at = parseUtc(sample.atUtc);
    if (Number.isFinite(start) && Number.isFinite(end) && (!Number.isFinite(at) || at < start || at > end)) {
      violations.push({
        code: 'sample-outside-window',
        subject: key,
        detail: `sample at ${sample.atUtc} lies outside the pinned window`,
      });
    }
  }
  return violations;
}

/**
 * The long-task half of the capture, judged on the same terms as the endpoint half.
 *
 * INV-3.10 counts over the PINNED interval, so an entry the window does not cover
 * is refused rather than counted: it would otherwise decide a bar it was never
 * inside. And a record the capture could not measure is surfaced rather than
 * dropped, for the reason `uiLagUnmeasurable` exists.
 */
function validateUiLag(proof: W3EndpointLatencyProof): W3Violation[] {
  const violations: W3Violation[] = [];
  const start = parseUtc(proof.window.startUtc);
  const end = parseUtc(proof.window.endUtc);
  for (const entry of proof.uiLag ?? []) {
    if (!Number.isFinite(entry.durationMs) || entry.durationMs < 0) {
      violations.push({
        code: 'negative-duration',
        subject: `ui-lag ${entry.atUtc}`,
        detail: `durationMs ${entry.durationMs} is not a non-negative measurement`,
      });
    }
    const at = parseUtc(entry.atUtc);
    if (Number.isFinite(start) && Number.isFinite(end) && (!Number.isFinite(at) || at < start || at > end)) {
      violations.push({
        code: 'sample-outside-window',
        subject: `ui-lag ${entry.atUtc}`,
        detail: 'a long task outside the pinned interval cannot be judged against it',
      });
    }
  }
  // Not `?? 0`. An absent count would read as "none", which makes deleting the
  // field cheaper than deleting the records — the same absent-denominator hole
  // `missing-route-attempts` closes on the endpoint half.
  // Every ui-lag record read in the window must still be accounted for as either a
  // written row or an unmeasurable one. This is `routeAttempts` for the long-task
  // half: without a denominator, deleting rows is invisible and INV-3.10 becomes a
  // count of whatever survived.
  const recordsRead = proof.uiLagRecordsRead;
  const accounted = (proof.uiLag?.length ?? 0) + (proof.uiLagUnmeasurable ?? 0);
  if (typeof recordsRead !== 'number' || !Number.isFinite(recordsRead) || recordsRead < 0) {
    violations.push({
      code: 'dropped-ui-lag',
      subject: 'uiLagRecordsRead',
      detail: 'the capture does not say how many ui-lag records it read, so its rows cannot be checked for censoring',
    });
  } else if (accounted !== recordsRead) {
    violations.push({
      code: 'dropped-ui-lag',
      subject: 'uiLagRecordsRead',
      detail: `${recordsRead} ui-lag record(s) were read and ${accounted} accounted for; ${recordsRead - accounted} went missing`,
    });
  }
  violations.push(
    ...declaredLoss({
      code: 'unmeasurable-ui-lag',
      field: 'uiLagUnmeasurable',
      value: proof.uiLagUnmeasurable,
      absent: 'the capture does not say how many ui-lag records it could not measure',
      nonZero: (count) =>
        `${count} ui-lag record(s) carried no readable duration; each may have been over the bar`,
    }),
    ...exportEnvelopeAgrees(proof.uiLagExportShortfall),
    ...pollsCoverTheSequence(proof.uiLagSequenceGaps),
  );
  return violations;
}

/**
 * The capture's polls must have covered the log's sequence without a break.
 *
 * Its own check rather than a `declaredLoss` count, because a range is the
 * answer here and a number is not: a reader told "three records are missing"
 * cannot say whether the window is still worth reporting, while a reader told
 * which records went and when can. Absence is refused for the usual reason —
 * treating a missing field as "no gaps" makes deleting the field cheaper than
 * deleting the records it accounts for.
 */
function pollsCoverTheSequence(gaps: unknown): W3Violation[] {
  if (!Array.isArray(gaps)) {
    return [{
      code: 'ui-lag-gap',
      subject: 'uiLagSequenceGaps',
      detail: 'the capture does not say whether its ui-lag polls covered the log without a break',
    }];
  }
  return (gaps as W3SequenceGap[]).map((gap) => ({
    code: 'ui-lag-gap' as const,
    subject: `seq ${gap?.fromSeq}..${gap?.toSeq}`,
    detail: `anomaly records ${gap?.fromSeq}..${gap?.toSeq} rotated out of the log before any poll read them; the long-task count is missing that range`,
  }));
}

/**
 * The ui-lag export's envelope must agree exactly with the array beside it.
 *
 * Its own check rather than a `declaredLoss` count, because this difference is
 * signed and each sign is a different untruth. Above zero the export matched
 * records it did not hand over, so the long-task count is a page of the window.
 * Below zero the envelope declares fewer records than it delivered, so nothing
 * in the file can be reconciled with anything else in it. Absent, and there is
 * no envelope to check at all — which must be refused rather than read as a
 * complete answer, for the reason `declaredLoss` states.
 */
function exportEnvelopeAgrees(difference: unknown): W3Violation[] {
  const subject = 'uiLagExportShortfall';
  if (typeof difference !== 'number' || !Number.isFinite(difference)) {
    return [{
      code: 'truncated-ui-lag-export',
      subject,
      detail: 'the capture does not say whether its ui-lag export was a complete answer or one page of it',
    }];
  }
  if (difference > 0) {
    return [{
      code: 'truncated-ui-lag-export',
      subject,
      detail: `the ui-lag export matched ${difference} record(s) it did not hand over; the long-task count is a page, not the window`,
    }];
  }
  if (difference < 0) {
    return [{
      code: 'truncated-ui-lag-export',
      subject,
      detail: `the ui-lag export declared ${-difference} record(s) fewer than it delivered; its envelope contradicts its own records`,
    }];
  }
  return [];
}

/**
 * A count of evidence the capture KNOWS it lost.
 *
 * Two fields have this exact shape, and each closes the same hole from a
 * different side: a number the capture must state, whose only acceptable value
 * is zero, and whose absence must be refused rather than read as zero. Absence
 * is the important half — a reader that treats a missing count as "none" makes
 * deleting the field cheaper than deleting the records it accounts for, which is
 * the move every censoring check here exists to block.
 */
function declaredLoss(spec: {
  code: W3ViolationCode;
  field: string;
  value: unknown;
  absent: string;
  nonZero: (count: number) => string;
}): W3Violation[] {
  const { value } = spec;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return [{ code: spec.code, subject: spec.field, detail: spec.absent }];
  }
  if (value > 0) {
    return [{ code: spec.code, subject: spec.field, detail: spec.nonZero(value) }];
  }
  return [];
}

function validateRouteCoverage(proof: W3EndpointLatencyProof): W3Violation[] {
  const violations: W3Violation[] = [];
  const byRoute = groupSamplesByRoute(proof.samples);
  const attemptsByRoute = attemptsBySourcedRoute(proof.routeAttempts);

  for (const required of W3_REQUIRED_ROUTES) {
    const key = requiredRouteKey(required);
    const samples = byRoute.get(key) ?? [];
    if (samples.length === 0) {
      violations.push({
        code: 'missing-route-row',
        subject: key,
        detail: 'the bar judges this route and the capture holds no row for it',
      });
      continue;
    }
    for (const source of ['daemon', 'web'] as const) {
      const attempts = attemptsByRoute.get(`${source} ${key}`);
      const written = samples.filter((sample) => sample.source === source).length;
      if (attempts == null && written > 0) {
        // Deleting the attempts entry is the cheapest way past `dropped-failures`:
        // with no denominator the comparison cannot fire at all.
        violations.push({
          code: 'missing-route-attempts',
          subject: key,
          detail: `${written} ${source} row(s) with no declared attempt count; the capture cannot be checked for dropped rows`,
        });
        continue;
      }
      if (attempts != null && written < attempts) {
        violations.push({
          code: 'dropped-failures',
          subject: key,
          detail: `${source} attempted ${attempts} observations and only ${written} rows were written`,
        });
      }
    }
    const daemonSamples = samples.filter((sample) => sample.source === 'daemon');
    if (daemonSamples.length === 0) {
      violations.push({
        code: 'web-only-route',
        subject: key,
        detail: 'every row is client-observed; browser queueing, not the handler, would set this p95 (D-21)',
      });
    }
    const successful = daemonSamples.filter((sample) => sample.outcome === 'success');
    if (successful.length < W3_MIN_SUCCESSFUL_SAMPLES) {
      violations.push({
        code: 'insufficient-samples',
        subject: key,
        detail: `${successful.length} successful daemon-side samples, ${W3_MIN_SUCCESSFUL_SAMPLES} required`,
      });
    }
  }
  return violations;
}

/** Attempts keyed by `<source> <normalized route>`, so each observer is accounted separately. */
function attemptsBySourcedRoute(entries: readonly W3RouteAttempts[] | undefined): Map<string, number> {
  const attempts = new Map<string, number>();
  for (const entry of entries ?? []) {
    const key = `${entry.source} ${normalizeRouteKey(entry.method, entry.route)}`;
    attempts.set(key, (attempts.get(key) ?? 0) + entry.attempts);
  }
  return attempts;
}

function groupSamplesByRoute(samples: readonly W3LatencySample[]): Map<string, W3LatencySample[]> {
  const grouped = new Map<string, W3LatencySample[]>();
  for (const sample of samples) {
    const key = normalizeRouteKey(sample.method, sample.route);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(sample);
    else grouped.set(key, [sample]);
  }
  return grouped;
}

export type W3RouteVerdict = 'PASS' | 'FAIL' | 'INSUFFICIENT';

export interface W3RouteReport {
  method: string;
  route: string;
  /** Daemon-side observations the capture attempted, when it declared them. */
  attempts: number | null;
  successfulSamples: number;
  /** Nearest-rank p95 over successful daemon-side samples; null when there are none. */
  daemonP95Ms: number | null;
  /** The same statistic over client-observed rows, reported beside it and never judged (D-21). */
  clientObservedP95Ms: number | null;
  outcomeCounts: Record<W3SampleOutcome, number>;
  /** Status code to count, so an availability failure cannot hide behind "successful only". */
  statusCounts: Record<string, number>;
  failures: number;
  verdict: W3RouteVerdict;
}

export interface W3UiLagDay {
  /** UTC calendar day, `YYYY-MM-DD`. */
  day: string;
  overThreshold: number;
}

export interface W3ProofReport {
  /** Every reason the capture itself is unsound; a non-empty list fails the bar outright. */
  violations: W3Violation[];
  routes: W3RouteReport[];
  /** Long tasks in the pinned interval — the count INV-3.10 is judged on (A4). */
  uiLagOverThreshold: number;
  /**
   * The same long tasks split by UTC calendar day. Reported for the PRD 3.6
   * baseline; a rolling 24 h window contains no complete calendar day, so this
   * table informs and `uiLagOverThreshold` decides.
   */
  uiLagByUtcDay: W3UiLagDay[];
  inv31: 'PASS' | 'FAIL';
  inv310: 'PASS' | 'FAIL';
  passed: boolean;
}

/**
 * Judges INV-3.1 and INV-3.10 from a capture.
 *
 * A route reads `INSUFFICIENT` rather than `PASS` when it has fewer than
 * `W3_MIN_SUCCESSFUL_SAMPLES` successful daemon-side samples, and an
 * `INSUFFICIENT` row fails the bar exactly like a slow one (A2): a route nobody
 * exercised is a route nobody proved.
 */
export function reportProof(proof: W3EndpointLatencyProof): W3ProofReport {
  const violations = validateProof(proof);
  const byRoute = groupSamplesByRoute(proof.samples);
  const attemptsByRoute = attemptsBySourcedRoute(proof.routeAttempts);

  const routes = W3_REQUIRED_ROUTES.map((required): W3RouteReport => {
    const key = requiredRouteKey(required);
    const samples = byRoute.get(key) ?? [];
    const daemonSamples = samples.filter((sample) => sample.source === 'daemon');
    const successful = daemonSamples.filter((sample) => sample.outcome === 'success');
    const clientObserved = samples.filter(
      (sample) => sample.source === 'web' && sample.outcome === 'success',
    );
    const daemonP95Ms = percentile95(successful);
    const verdict: W3RouteVerdict = successful.length < W3_MIN_SUCCESSFUL_SAMPLES
      ? 'INSUFFICIENT'
      : (daemonP95Ms ?? Number.POSITIVE_INFINITY) < W3_ROUTE_P95_BUDGET_MS
        ? 'PASS'
        : 'FAIL';
    return {
      method: required.method,
      route: required.route,
      attempts: attemptsByRoute.get(`daemon ${key}`) ?? null,
      successfulSamples: successful.length,
      daemonP95Ms,
      clientObservedP95Ms: percentile95(clientObserved),
      outcomeCounts: countOutcomes(samples),
      statusCounts: countStatuses(samples),
      failures: samples.filter((sample) => sample.outcome !== 'success').length,
      verdict,
    };
  });

  const longTasks = proof.uiLag.filter((entry) => entry.durationMs > W3_UI_LAG_THRESHOLD_MS);
  const byDay = new Map<string, number>();
  for (const entry of longTasks) {
    const day = entry.atUtc.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }

  const inv31 = routes.every((route) => route.verdict === 'PASS') ? 'PASS' : 'FAIL';
  const inv310 = longTasks.length < W3_UI_LAG_MAX_PER_WINDOW ? 'PASS' : 'FAIL';
  return {
    violations,
    routes,
    uiLagOverThreshold: longTasks.length,
    uiLagByUtcDay: [...byDay.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([day, overThreshold]) => ({ day, overThreshold })),
    inv31,
    inv310,
    passed: violations.length === 0 && inv31 === 'PASS' && inv310 === 'PASS',
  };
}

/**
 * Nearest-rank p95, the same rule the page-load benchmark gates on — imported
 * rather than restated so the two proofs cannot drift onto different
 * definitions of the same word.
 */
function percentile95(samples: readonly W3LatencySample[]): number | null {
  if (samples.length === 0) return null;
  return summarizeSamples(samples.map((sample) => sample.durationMs)).p95Ms;
}

function countOutcomes(samples: readonly W3LatencySample[]): Record<W3SampleOutcome, number> {
  const counts: Record<W3SampleOutcome, number> = {
    'success': 0,
    'client-error': 0,
    'server-error': 0,
    'unreachable': 0,
  };
  for (const sample of samples) {
    if (W3_SAMPLE_OUTCOMES.includes(sample.outcome)) counts[sample.outcome] += 1;
  }
  return counts;
}

function countStatuses(samples: readonly W3LatencySample[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const sample of samples) {
    const key = String(sample.status);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
