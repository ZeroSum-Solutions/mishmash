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
    summarise: (p) => `Preview iframe never finished loading within ${num(p, 'timeout_ms') ?? '?'}ms`,
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
