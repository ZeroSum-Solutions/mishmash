/**
 * Model routing truth (W1 / NM-13a).
 *
 * "One authoritative model badge" is not achievable: Codex's `thread.started`
 * event carries only a session id, and Antigravity's `agy` speaks a plain
 * stream with no structured init event -- neither lane can always echo what
 * actually executed. The honest goal is truthful uncertainty, not false
 * certainty, so every run's model identity is three distinct facts instead
 * of one:
 *
 *   - `requested` -- what the user (or picker default) asked for, verbatim.
 *   - `resolved`  -- what the daemon actually launched the CLI with, after
 *                    any fallback/substitution logic (`resolveModelForAgent`).
 *   - `reported`  -- what the CLI itself echoed back, when its wire format
 *                    carries that signal. `null` is a legitimate value for a
 *                    lane whose evidence ceiling means it can never echo.
 *
 * `displayState` is derived from those three so the daemon and every
 * consumer (web UI, CLI, telemetry) agree on one verdict instead of each
 * re-deriving it slightly differently.
 */

export type ModelRoutingDisplayState = 'verified' | 'substituted' | 'unverified';

export interface RunModelRouting {
  requested: string;
  resolved: string;
  reported: string | null;
  displayState: ModelRoutingDisplayState;
}

/** Sentinel stored for "no explicit model was named" so `requested`/
 *  `resolved` are always non-null, populated strings (every successful run
 *  must carry both -- a permanently-null field would satisfy the letter of
 *  that rule while carrying no information). */
export const MODEL_ROUTING_DEFAULT_SENTINEL = 'default';

/** Trims a possibly-absent model id down to a non-empty string, falling back
 *  to the `'default'` sentinel for null/undefined/blank input. */
export function normalizeModelForRouting(value: string | null | undefined): string {
  if (typeof value !== 'string') return MODEL_ROUTING_DEFAULT_SENTINEL;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : MODEL_ROUTING_DEFAULT_SENTINEL;
}

/**
 * Derives the display state from the three already-normalized fields.
 *
 * Precedence (deliberately not a set of independent, possibly-conflicting
 * conditions):
 *   1. `resolved !== requested`, for an explicit request -- a substitution
 *      happened; that is the most important thing to tell the user, whether
 *      or not it was later confirmed by an echo. A `requested` equal to the
 *      `'default'` sentinel names no model at all, so nothing can be
 *      substituted for it: resolving it to the lane's concrete model is the
 *      requested behavior, not a swap worth an alarm.
 *   2. `reported === resolved` (and non-null) -- what ran matches what the
 *      daemon asked for, and the CLI confirmed it. `verified`.
 *   3. Otherwise -- no substitution occurred, but nothing confirms it either
 *      (no echo, or an echo that disagrees). `unverified`. An echo that
 *      disagrees with `resolved` is not treated as extra "substituted"
 *      evidence -- `resolved` reflects the daemon's own launch decision,
 *      which by definition matched `requested` in this branch.
 */
export function computeModelRoutingDisplayState(
  requested: string,
  resolved: string,
  reported: string | null,
): ModelRoutingDisplayState {
  if (requested !== MODEL_ROUTING_DEFAULT_SENTINEL && resolved !== requested) {
    return 'substituted';
  }
  if (reported && reported === resolved) return 'verified';
  return 'unverified';
}

/**
 * Builds the full `RunModelRouting` record from the raw, possibly-null
 * components a daemon run accumulates over its lifecycle.
 *
 * `resolvedRaw` is null when `resolveModelForAgent` deliberately deferred to
 * the CLI's own default (e.g. an invalid custom model id sanitizes to null,
 * and the def lists its own `'default'` fallback) -- in that case the only
 * way to know what actually ran is the CLI's own echo, so `resolved` is
 * backfilled from `reportedRaw` when present, and falls back to the shared
 * `'default'` sentinel otherwise (mirroring `requested`'s own fallback).
 */
export function buildModelRouting(params: {
  requestedRaw: string | null | undefined;
  resolvedRaw: string | null | undefined;
  reportedRaw: string | null | undefined;
}): RunModelRouting {
  const requested = normalizeModelForRouting(params.requestedRaw);
  const resolvedRawTrimmed =
    typeof params.resolvedRaw === 'string' ? params.resolvedRaw.trim() : '';
  const resolved =
    resolvedRawTrimmed.length > 0
      ? resolvedRawTrimmed
      : normalizeModelForRouting(params.reportedRaw);
  const reportedRawTrimmed =
    typeof params.reportedRaw === 'string' ? params.reportedRaw.trim() : '';
  const reported = reportedRawTrimmed.length > 0 ? reportedRawTrimmed : null;
  return {
    requested,
    resolved,
    reported,
    displayState: computeModelRoutingDisplayState(requested, resolved, reported),
  };
}
