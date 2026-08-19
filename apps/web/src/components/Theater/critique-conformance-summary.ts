import type { ConformanceDayDto } from '@open-design/contracts';

export interface CritiqueConformanceSummary {
  totalRuns: number;
  /** Run-weighted shipped rate across the window, 0-100. */
  shippedPct: number;
  /** Run-weighted clean-parse rate across the window, 0-100. */
  cleanPct: number;
}

/**
 * Collapses a `ConformanceDayDto[]` window (one row per adapter per day)
 * into a single run-weighted summary for display. Weighted by
 * `totalRuns` rather than averaged per-row, so a day with one run and a
 * day with a thousand don't count equally — a naive per-row average
 * would let a quiet adapter's noisy single-run rate swing the headline
 * number as much as the fleet's actual volume.
 *
 * Returns `null` for an empty window so callers can render an explicit
 * "no data yet" state instead of a misleading 0%.
 */
export function summarizeConformanceHistory(
  history: readonly ConformanceDayDto[],
): CritiqueConformanceSummary | null {
  if (history.length === 0) return null;
  let totalRuns = 0;
  let shippedWeighted = 0;
  let cleanWeighted = 0;
  for (const day of history) {
    totalRuns += day.totalRuns;
    shippedWeighted += day.shippedRate * day.totalRuns;
    cleanWeighted += day.cleanParseRate * day.totalRuns;
  }
  if (totalRuns === 0) return { totalRuns: 0, shippedPct: 0, cleanPct: 0 };
  return {
    totalRuns,
    shippedPct: Math.round((shippedWeighted / totalRuns) * 100),
    cleanPct: Math.round((cleanWeighted / totalRuns) * 100),
  };
}
