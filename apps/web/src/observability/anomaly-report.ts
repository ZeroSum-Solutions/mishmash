// Web → daemon anomaly reporting.
//
// The observability probes in this directory already detect the things that go
// wrong: main-thread stalls, white screens, failed sub-resources, dead preview
// iframes, runs that stop making progress. They report through
// `reportSafetyEvent`, which posts to PostHog — and PostHog is a no-op without a
// build-time key, so during ordinary local use every one of those detections was
// buffered and dropped. Nothing was wrong with the detection; there was no sink.
//
// This module is the sink's client half. It does two things:
//
//  1. `reportAnomaly` posts a record to the daemon for a caller that has
//     detected something directly.
//  2. `anomalyForSafetyEvent` maps the EXISTING safety events onto anomaly
//     records, so the probes keep their single call site and start producing
//     local records without being rewritten.
//
// The map is an allowlist, not a passthrough. Most safety events describe normal
// operation — boot timings, visibility changes, a run recovering — and a log
// that fills with healthy events cannot be skimmed for the unhealthy ones.

import type { AnomalyKind, AnomalySeverity, ReportAnomalyRequest } from '@open-design/contracts';

/** How a safety event becomes an anomaly record. */
interface SafetyEventMapping {
  kind: AnomalyKind;
  severity: AnomalySeverity;
  /**
   * Builds the one-line summary from the event's own properties. Written for a
   * person reading the log later, so it states the measurement, not the category
   * — the `kind` field already carries the category.
   */
  summarise: (properties: Record<string, unknown>) => string;
}

function num(properties: Record<string, unknown>, key: string): number | null {
  const raw = properties[key];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function str(properties: Record<string, unknown>, key: string): string | null {
  const raw = properties[key];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

function seconds(ms: number | null): string {
  return ms == null ? 'an unknown time' : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Safety events that describe something WRONG. Anything absent from this map is
 * deliberately not an anomaly:
 *
 *  - `client_boot_timing`, `client_visibility_change`, `client_session_summary`
 *    are normal-operation measurements.
 *  - `client_run_unstuck` is a run RECOVERING, which is the good outcome; the
 *    `client_run_stuck` that preceded it is the record worth keeping.
 */
const SAFETY_EVENT_ANOMALIES: Record<string, SafetyEventMapping> = {
  client_long_task: {
    kind: 'ui-lag',
    severity: 'warn',
    summarise: (p) => {
      const ms = num(p, 'duration_ms');
      const container = str(p, 'container_name') ?? str(p, 'container_type');
      return `Main thread blocked for ${ms ?? '?'}ms${container ? ` (${container})` : ''}`;
    },
  },
  client_white_screen: {
    kind: 'white-screen',
    severity: 'error',
    summarise: (p) =>
      `App did not mount within ${num(p, 'timeout_ms') ?? '?'}ms ` +
      `(readyState ${str(p, 'ready_state') ?? '?'}, ${num(p, 'body_child_count') ?? '?'} body children)`,
  },
  client_resource_error: {
    kind: 'resource-failed',
    severity: 'warn',
    summarise: (p) => `<${str(p, 'tag') ?? 'resource'}> failed to load: ${str(p, 'url') ?? 'unknown url'}`,
  },
  client_iframe_error: {
    kind: 'preview-error',
    severity: 'warn',
    summarise: () => 'Preview iframe reported a load error',
  },
  client_iframe_timeout: {
    kind: 'preview-error',
    severity: 'warn',
    // Two different failures share this event, and a maintainer reading the log
    // needs them apart: a frame that never answered at all is usually a
    // transport problem, while one that answered and reported no laid-out box
    // is a document that ran and rendered nothing.
    summarise: (p) =>
      str(p, 'reason') === 'no_render_evidence'
        ? `Preview iframe reported nothing rendered within ${num(p, 'timeout_ms') ?? '?'}ms`
        : `Preview iframe never proved it rendered within ${num(p, 'timeout_ms') ?? '?'}ms`,
  },
  client_run_stuck: {
    kind: 'run-stuck',
    severity: 'error',
    summarise: (p) =>
      `Run made no progress for ${seconds(num(p, 'duration_since_last_progress_ms'))} ` +
      `(${seconds(num(p, 'duration_since_start_ms'))} since it started)`,
  },
};

/**
 * Translates a safety event into an anomaly record, or returns null when the
 * event describes normal operation.
 */
export function anomalyForSafetyEvent(
  eventName: string,
  properties: Record<string, unknown>,
): ReportAnomalyRequest | null {
  const mapping = SAFETY_EVENT_ANOMALIES[eventName];
  if (!mapping) return null;
  const runId = str(properties, 'run_id');
  const projectId = str(properties, 'project_id');
  return {
    kind: mapping.kind,
    severity: mapping.severity,
    summary: mapping.summarise(properties),
    ...(projectId ? { projectId } : {}),
    ...(runId ? { runId } : {}),
    detail: { safetyEvent: eventName, ...properties },
  };
}

/**
 * How long an identical failure stays suppressed after it is filed once.
 * A thrown exception inside a render loop repeats every frame; without this the
 * log would fill with one signature and rotate away the history a reader needs.
 */
const UNCAUGHT_SUPPRESS_WINDOW_MS = 60_000;

/**
 * Ceiling on how many DISTINCT signatures one session may file. A loop whose
 * message varies (an index, a timestamp) defeats signature suppression, so the
 * count is bounded too. Matches the 50-entry cap the PostHog buffer in
 * `error-tracking.ts` already uses for the same reason.
 */
const UNCAUGHT_MAX_DISTINCT = 50;

const uncaughtLastFiledAt = new Map<string, number>();

/**
 * Test seam. Module state would otherwise leak the suppression window between
 * specs and make them order-dependent.
 */
export function resetUncaughtExceptionAnomalyState(): void {
  uncaughtLastFiledAt.clear();
}

/**
 * Decides whether this exception is worth a record. Returns true the first time
 * a signature is seen, false while it is repeating, and false for every new
 * signature once the session has filed `UNCAUGHT_MAX_DISTINCT` of them.
 *
 * Deliberately not a rate limit on the total: a burst of genuinely different
 * failures is exactly the situation worth recording in full.
 */
export function shouldFileUncaughtException(signature: string): boolean {
  const now = Date.now();
  const last = uncaughtLastFiledAt.get(signature);
  if (last != null && now - last < UNCAUGHT_SUPPRESS_WINDOW_MS) return false;
  if (last == null && uncaughtLastFiledAt.size >= UNCAUGHT_MAX_DISTINCT) return false;
  uncaughtLastFiledAt.set(signature, now);
  return true;
}

/** What the window listeners observed about one uncaught failure. */
export interface UncaughtExceptionInput {
  message: string;
  /** Script URL the exception came from, when the engine reported one. */
  source?: string;
  lineno?: number;
  /** True for `unhandledrejection`, false/absent for a thrown `error`. */
  rejection?: boolean;
}

/** Last path segment, so the summary names a file rather than a full URL. */
function sourceLabel(source: string | undefined): string | null {
  if (!source) return null;
  const withoutQuery = source.split(/[?#]/u)[0] ?? source;
  const segments = withoutQuery.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  return last && last.length > 0 ? last : null;
}

/**
 * Builds the anomaly record for an uncaught error or an unhandled rejection.
 *
 * `AnomalyKind` has declared `'unhandled-error'` since the log landed but
 * nothing produced it — browser exceptions went only to PostHog, which is a
 * no-op without a build-time key, so during ordinary local use they vanished.
 */
export function anomalyForUncaughtException(
  input: UncaughtExceptionInput,
): ReportAnomalyRequest {
  const rejection = input.rejection === true;
  const message = input.message.trim();
  const label = sourceLabel(input.source);
  const where = label ? ` at ${label}${input.lineno != null ? `:${input.lineno}` : ''}` : '';
  const what = message.length > 0 ? message : 'no message reported';
  const prefix = rejection ? 'Unhandled promise rejection' : 'Uncaught error';

  return {
    kind: 'unhandled-error',
    severity: 'error',
    summary: `${prefix}: ${what}${where}`,
    detail: {
      ...(input.source ? { source: input.source } : {}),
      ...(input.lineno != null ? { lineno: input.lineno } : {}),
      ...(rejection ? { rejection: true } : {}),
    },
  };
}

/**
 * Bridge called from the window listeners in `error-tracking.ts`. Applies the
 * flood guard, then posts. Kept here rather than inside the PostHog transport
 * so the two sinks stay independent — the transport's specs assert exact call
 * counts, which is why this hook was deferred when the anomaly log landed.
 */
export function reportUncaughtExceptionAnomaly(input: UncaughtExceptionInput): void {
  const signature = `${input.rejection === true ? 'rejection' : 'error'}:${input.message}:${input.source ?? ''}`;
  if (!shouldFileUncaughtException(signature)) return;
  reportAnomaly(anomalyForUncaughtException(input));
}

/** Endpoint the daemon exposes for client-reported anomalies. */
export const ANOMALY_ENDPOINT = '/api/anomalies';

/**
 * Posts one anomaly to the daemon. Best-effort and silent by design: the
 * anomaly log exists to record product failures, so it must never itself
 * become one — a failed report is dropped rather than raised, retried, or
 * logged into the console noise it is meant to replace.
 *
 * `keepalive` so a report fired during navigation still leaves the tab.
 */
export function reportAnomaly(input: ReportAnomalyRequest): void {
  if (typeof fetch !== 'function') return;
  try {
    void fetch(ANOMALY_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      keepalive: true,
    }).catch(() => {
      // Swallowed on purpose. An unhandled rejection here would be caught by
      // the app's own `unhandledrejection` listener and re-reported as an
      // exception — telemetry manufacturing telemetry.
    });
  } catch {
    // fetch can throw synchronously on a malformed argument; never propagate.
  }
}

/**
 * Bridge called from `reportSafetyEvent`. Kept separate from `reportAnomaly` so
 * the mapping decision is testable without a network call.
 */
export function reportAnomalyForSafetyEvent(
  eventName: string,
  properties: Record<string, unknown>,
): void {
  const anomaly = anomalyForSafetyEvent(eventName, properties);
  if (anomaly) reportAnomaly(anomaly);
}
