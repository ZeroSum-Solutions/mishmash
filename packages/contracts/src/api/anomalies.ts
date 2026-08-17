// Anomaly log — the local record of things that went wrong or looked
// inconsistent while the product was in use.
//
// This is deliberately NOT analytics. The observability probes in
// `apps/web/src/observability/` already report to PostHog, and PostHog is a
// no-op without a build-time key (see `apps/daemon/src/analytics.ts`), which
// means that during ordinary local use every anomaly the app already noticed
// was discarded. The anomaly log is the local sink those signals needed: it
// lives on disk under the daemon's data root, survives restarts, and is
// readable by a person or an agent afterwards without a dashboard.
//
// A record answers one question: what did the product do that it should not
// have? Normal-operation telemetry (page views, boot timings, visibility
// changes) does not belong here — a log that fills with healthy events cannot
// be skimmed for the unhealthy ones.

/**
 * Stable anomaly categories. A closed union on purpose: adding a kind is a
 * deliberate edit in one place, and it keeps a typo from silently creating a
 * category that no reader ever groups on.
 */
export type AnomalyKind =
  /** Main thread blocked long enough for a person to read it as lag. */
  | 'ui-lag'
  /** The app rendered an empty root — a white screen. */
  | 'white-screen'
  /** A stylesheet, script, font, or image the page asked for never loaded. */
  | 'resource-failed'
  /** A preview iframe reported an error from inside the artifact. */
  | 'preview-error'
  /** A run stopped producing output while still claiming to be active. */
  | 'run-stuck'
  /** An HTTP call answered with a failure status. */
  | 'request-failed'
  /** An HTTP call never answered at all (network error, connection refused). */
  | 'request-unreachable'
  /** An HTTP call answered, but took longer than its budget. */
  | 'request-slow'
  /**
   * Classifier of last resort: a record reached the store without a kind this
   * union recognises. Nothing reports it deliberately — seeing one means a
   * caller went around the contract, which is itself worth knowing.
   *
   * Browser exceptions are NOT filed here yet. `apps/web/src/analytics/
   * error-tracking.ts` already scrubs and noise-filters them for PostHog, and
   * bridging that to the anomaly log belongs in its own change: the hook has to
   * sit beside the window listeners rather than inside the PostHog transport
   * function, whose specs assert exact transport call counts.
   */
  | 'unhandled-error';

/**
 * `error` is for something that definitely broke and the user either saw it or
 * lost work to it. `warn` is for something inconsistent or degraded that the
 * product survived. Severity drives ordering when the log is read back, so it
 * is the field that decides what a reader looks at first.
 */
export type AnomalySeverity = 'warn' | 'error';

/** Which process noticed the anomaly. */
export type AnomalySource = 'web' | 'daemon';

export interface AnomalyRecord {
  /** Unique per record, so a reader can refer to one line unambiguously. */
  id: string;
  /** ISO-8601 timestamp of when the anomaly was observed. */
  at: string;
  kind: AnomalyKind;
  severity: AnomalySeverity;
  source: AnomalySource;
  /**
   * One line, written for a person: what happened, concretely enough to act on.
   * Not a category name repeated — the kind already carries that.
   */
  summary: string;
  /** Project the anomaly happened in, when it belongs to one. */
  projectId?: string;
  /** Run the anomaly happened during, when it belongs to one. */
  runId?: string;
  /**
   * Structured evidence: durations, statuses, URLs, selectors. Bounded and
   * redacted on write, so a caller may pass what it has without pre-trimming.
   */
  detail?: Record<string, unknown>;
}

/**
 * Client-reported anomaly. `source` and `id`/`at` are stamped by the daemon —
 * a caller cannot claim to be a different process or backdate a record.
 */
export interface ReportAnomalyRequest {
  kind: AnomalyKind;
  severity: AnomalySeverity;
  summary: string;
  projectId?: string;
  runId?: string;
  detail?: Record<string, unknown>;
}

export interface ReportAnomalyResponse {
  ok: true;
  id: string;
}

export interface ListAnomaliesQuery {
  /** Newest-first cap on returned records. */
  limit?: number;
  /** Only records at or after this ISO timestamp. */
  since?: string;
  /** Only records of this kind. */
  kind?: AnomalyKind;
  /** Only records at this severity. */
  severity?: AnomalySeverity;
}

export interface ListAnomaliesResponse {
  /** Newest first, so the most recent problem is the first thing read. */
  anomalies: AnomalyRecord[];
  /** How many records the log holds in total, before `limit` was applied. */
  total: number;
  /** Absolute path of the log file, so a reader can go straight to it. */
  path: string;
}

export interface ClearAnomaliesResponse {
  ok: true;
  /** How many records were discarded. */
  cleared: number;
}

/** Every kind, for callers that need to validate or enumerate. */
export const ANOMALY_KINDS: readonly AnomalyKind[] = [
  'ui-lag',
  'white-screen',
  'resource-failed',
  'preview-error',
  'run-stuck',
  'request-failed',
  'request-unreachable',
  'request-slow',
  'unhandled-error',
];

export const ANOMALY_SEVERITIES: readonly AnomalySeverity[] = ['warn', 'error'];

export function isAnomalyKind(value: unknown): value is AnomalyKind {
  return typeof value === 'string' && (ANOMALY_KINDS as readonly string[]).includes(value);
}

export function isAnomalySeverity(value: unknown): value is AnomalySeverity {
  return typeof value === 'string' && (ANOMALY_SEVERITIES as readonly string[]).includes(value);
}
