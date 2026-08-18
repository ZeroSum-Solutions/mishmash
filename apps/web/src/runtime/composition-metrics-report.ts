// Web-host half of the rendered layout-risk measurement channel. See
// `CompositionMetrics` in `@open-design/contracts` and
// `injectCompositionMetricsBridge` in `apps/web/src/runtime/srcdoc.ts` for
// what is measured and why. This module only ever relays what the preview
// bridge already computed — it never measures anything itself.

import type { CompositionMetricsRecord, ReportCompositionMetricsRequest } from '@open-design/contracts';

export const COMPOSITION_METRICS_ENDPOINT = '/api/composition-metrics';

/**
 * Posts one rendered measurement to the daemon. Best-effort and silent by
 * design, matching `reportAnomaly` (`apps/web/src/observability/anomaly-
 * report.ts`) — this fires on every preview settle, so a failed report must
 * never surface as a user-visible error.
 *
 * `onRecord`, when given, receives the daemon's stored record (including
 * the server-resolved `isWebCloneRun`) once the report lands, so a caller
 * can update UI state without a second round trip.
 */
export function reportCompositionMetrics(
  input: ReportCompositionMetricsRequest,
  onRecord?: (record: CompositionMetricsRecord) => void,
): void {
  if (typeof fetch !== 'function') return;
  try {
    fetch(COMPOSITION_METRICS_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      keepalive: true,
    })
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((data) => {
        const record = (data as { ok?: boolean; record?: CompositionMetricsRecord } | null)?.record;
        if (record && onRecord) onRecord(record);
      })
      .catch(() => {
        // Swallowed on purpose — see the docblock above.
      });
  } catch {
    // fetch can throw synchronously on a malformed argument; never propagate.
  }
}

/** Reads back the last reported measurement for `(projectId, file)`, or `null`. */
export function fetchCompositionMetrics(
  projectId: string,
  file: string,
): Promise<CompositionMetricsRecord | null> {
  if (typeof fetch !== 'function') return Promise.resolve(null);
  const query = new URLSearchParams({ projectId, file });
  return fetch(`${COMPOSITION_METRICS_ENDPOINT}?${query.toString()}`)
    .then((resp) => (resp.ok ? resp.json() : null))
    .then((data) => {
      const body = data as { ok?: boolean; record?: CompositionMetricsRecord | null } | null;
      return body?.ok ? (body.record ?? null) : null;
    })
    .catch(() => null);
}
