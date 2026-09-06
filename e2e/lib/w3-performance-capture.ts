// Turns one daemon request-timing log plus a `ui-lag` anomaly export into the
// pinned `W3EndpointLatencyProof` at `proof/w3/endpoint-latency-24h.json`.
//
// Two sources, because no single one can carry the proof. Endpoint durations
// come from the daemon's opt-in request-timing capture
// (`apps/daemon/src/http/request-timing-log.ts`), which journals EVERY request
// attempt — the ones that never answered included: the anomaly log holds only
// failures and requests over 4 s, so a p95 taken from it would be the p95 of the
// outliers. Long tasks come from
// `GET /api/anomalies?kind=ui-lag`, which is where the web's `longtask`
// observer already files them and where they belong — they are the product
// misbehaving, which is what that log is for.
//
// Run it after the capture window closes:
//
//   pnpm exec tsx lib/w3-performance-capture.ts \
//     --timing-log <data root>/request-timing/requests.jsonl \
//     --anomalies <ui-lag export>.json \
//     --start 2026-09-06T09:00:00.000Z \
//     --source-run w3-24h-1 --daemon-sha <sha> --runtime "<machine>" \
//     --workload "<what was being done>" --open-tabs 2 \
//     --foreground-exposure "<how long a tab was visible>" --cache-policy warm \
//     --out ../.claude/goal-state/.../proof/w3/endpoint-latency-24h.json

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import type { AnomalyRecord, ListAnomaliesResponse } from '@open-design/contracts';

import {
  W3_CACHE_POLICIES,
  W3_ROUTE_NORMALIZATION_KEY,
  W3_WINDOW_MS,
  normalizeRouteKey,
  type W3CachePolicy,
  type W3CaptureMetadata,
  type W3EndpointLatencyProof,
  type W3Interval,
  type W3LatencySample,
  type W3RouteAttempts,
  type W3SampleOutcome,
  type W3TimingSource,
  type W3UiLagSample,
} from './w3-performance-proof.js';

/**
 * One line of the daemon's request-timing log.
 *
 * The daemon journals every request twice: an attempt on arrival, and a terminal
 * row carrying the status it ended with (`apps/daemon/src/http/request-timing-log.ts`).
 * Declared here rather than imported: this is a file format read off disk, and
 * e2e may not reach into `apps/daemon/src` for a shared helper. `parseTimingLine`
 * is therefore the boundary validator — an unparseable or half-written line is
 * dropped, never guessed at.
 */
interface TimingStartLine {
  phase: 'start';
  id: string;
  method: string;
  route: string;
  atUtc: string;
}

interface TimingEndLine extends Omit<TimingStartLine, 'phase'> {
  phase: 'end';
  status: number;
  durationMs: number;
}

type TimingLine = TimingStartLine | TimingEndLine;

/**
 * One request as the capture sees it, whether or not it ever ended.
 *
 * An attempt with no terminal row beside it is a request the daemon received
 * and never answered — the exact condition the journal exists to make visible.
 * It is carried here with status 0 rather than discarded, so it reaches
 * `samples` and its route's attempt count like every other observation.
 */
interface TimingObservation {
  method: string;
  route: string;
  status: number;
  durationMs: number;
  atUtc: string;
}

/**
 * How a status maps onto the closed outcome set.
 *
 * Status 0 means the request never answered. Every non-2xx/3xx observation
 * stays in the capture under its own outcome rather than being dropped:
 * dropping them is precisely the censoring the validator refuses.
 */
export function outcomeForStatus(status: number): W3SampleOutcome {
  if (status === 0) return 'unreachable';
  if (status >= 500) return 'server-error';
  if (status >= 400) return 'client-error';
  return 'success';
}

function parseTimingLine(line: string): TimingLine | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // A killed daemon leaves a torn last line; it must not void the capture.
    return null;
  }
  if (parsed == null || typeof parsed !== 'object') return null;
  const row = parsed as Record<string, unknown>;
  const phase = row['phase'];
  if (phase !== 'start' && phase !== 'end') return null;
  const { id, method, route, atUtc, status, durationMs } = row;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof method !== 'string' || method === '') return null;
  if (typeof route !== 'string' || route === '') return null;
  if (typeof atUtc !== 'string' || !Number.isFinite(Date.parse(atUtc))) return null;
  if (phase === 'start') return { phase: 'start', id, method, route, atUtc };
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs)) return null;
  if (typeof status !== 'number' || !Number.isFinite(status)) return null;
  return { phase: 'end', id, method, route, atUtc, status, durationMs };
}

/**
 * Every attempt the log journaled, terminated or not.
 *
 * The invariant: a start line and the terminal line that shares its id are ONE
 * observation, and a start line with no such terminal line is still one. Pairing
 * runs over the whole file before any window filter, so a request that arrived
 * inside the window and ended outside it is not mistaken for an attempt nobody
 * answered.
 *
 * An unterminated attempt is recorded with status 0 — `unreachable` — and a
 * duration of 0. The zero is not a claim that it was fast: a request that never
 * ended has no elapsed time to report, and the percentiles the bar is judged on
 * are taken over SUCCESSFUL rows only, so the row can only ever move the failure
 * counts it belongs in.
 */
function pairAttempts(lines: readonly TimingLine[]): TimingObservation[] {
  const terminated = new Set(lines.filter((line) => line.phase === 'end').map((line) => line.id));
  const observations: TimingObservation[] = [];
  for (const line of lines) {
    if (line.phase === 'end') {
      observations.push({
        method: line.method,
        route: line.route,
        status: line.status,
        durationMs: line.durationMs,
        atUtc: line.atUtc,
      });
      continue;
    }
    if (terminated.has(line.id)) continue;
    observations.push({
      method: line.method,
      route: line.route,
      status: 0,
      durationMs: 0,
      atUtc: line.atUtc,
    });
  }
  return observations;
}

export interface ReadTimingLogResult {
  samples: W3LatencySample[];
  routeAttempts: W3RouteAttempts[];
  /** Lines the parser refused, so a damaged capture is visible rather than quietly smaller. */
  unparseableLines: number;
}

/**
 * Reads a request-timing log into samples and the per-route attempt counts.
 *
 * Every journaled attempt becomes exactly one sample, including an attempt that
 * never terminated; none is dropped. Attempts are counted from the same pass
 * that writes the rows, so the two can only disagree if rows were removed
 * afterwards — which is the check the validator's `dropped-failures` rule
 * performs.
 */
export function readTimingLog(
  contents: string,
  options: { window: W3Interval; sourceRun: string; source?: W3TimingSource },
): ReadTimingLogResult {
  const start = Date.parse(options.window.startUtc);
  const end = Date.parse(options.window.endUtc);
  const source: W3TimingSource = options.source ?? 'daemon';
  const samples: W3LatencySample[] = [];
  const attempts = new Map<string, W3RouteAttempts>();
  let unparseableLines = 0;

  const parsed: TimingLine[] = [];
  for (const line of contents.split('\n')) {
    if (line.trim() === '') continue;
    const row = parseTimingLine(line);
    if (row == null) {
      unparseableLines += 1;
      continue;
    }
    parsed.push(row);
  }

  for (const row of pairAttempts(parsed)) {
    const at = Date.parse(row.atUtc);
    if (at < start || at > end) continue;
    const key = normalizeRouteKey(row.method, row.route);
    const [method, route] = splitRouteKey(key);
    const existing = attempts.get(key);
    if (existing) existing.attempts += 1;
    else attempts.set(key, { method, route, source, attempts: 1 });
    samples.push({
      method,
      route,
      durationMs: row.durationMs,
      atUtc: row.atUtc,
      outcome: outcomeForStatus(row.status),
      status: row.status,
      sourceRun: options.sourceRun,
      source,
    });
  }

  return { samples, routeAttempts: [...attempts.values()], unparseableLines };
}

function splitRouteKey(key: string): [string, string] {
  const index = key.indexOf(' ');
  return [key.slice(0, index), key.slice(index + 1)];
}

export interface ReadUiLagResult {
  samples: W3UiLagSample[];
  /**
   * In-window `ui-lag` records that carried no readable duration, reported so a
   * damaged export is visible rather than quietly smaller — the same reason
   * `ReadTimingLogResult` carries `unparseableLines`.
   */
  unmeasurable: number;
  /**
   * Every in-window `ui-lag` record read, measured or not: the denominator the
   * validator checks `samples` and `unmeasurable` add back up to, so rows deleted
   * after the capture cannot pass as rows that never existed.
   */
  recordsRead: number;
}

/**
 * Reads `ui-lag` records into long-task samples.
 *
 * The web writes the measured duration into the free-form `detail` object as
 * `duration_ms` (`apps/web/src/observability/anomaly-report.ts`), not as a
 * column, so a record without a numeric one carries no measurement.
 *
 * Such a record is COUNTED, not skipped. The web always writes `duration_ms`
 * today, so its absence is itself anomalous, and the missing number might have
 * been over the bar — dropping it silently would shrink exactly the count
 * INV-3.10 is judged on. The validator refuses a capture that reports any.
 */
export function readUiLag(records: readonly AnomalyRecord[], window: W3Interval): ReadUiLagResult {
  const start = Date.parse(window.startUtc);
  const end = Date.parse(window.endUtc);
  const samples: W3UiLagSample[] = [];
  let unmeasurable = 0;
  let recordsRead = 0;
  for (const record of records) {
    if (record.kind !== 'ui-lag') continue;
    const at = Date.parse(record.at);
    if (!Number.isFinite(at) || at < start || at > end) continue;
    recordsRead += 1;
    const duration = record.detail?.['duration_ms'];
    if (typeof duration !== 'number' || !Number.isFinite(duration)) {
      unmeasurable += 1;
      continue;
    }
    samples.push({ atUtc: record.at, durationMs: duration });
  }
  return { samples, unmeasurable, recordsRead };
}

export interface BuildProofInput {
  timingLog: string;
  anomalies: ListAnomaliesResponse;
  /** Start of the pinned window; the end is fixed 24 h later. */
  startUtc: string;
  sourceRun: string;
  capture: Omit<W3CaptureMetadata, 'normalizationKey'>;
  /** Stretches with no observer, e.g. a daemon restart. Empty means continuous. */
  gaps?: W3Interval[];
}

export function buildProof(input: BuildProofInput): W3EndpointLatencyProof {
  const start = Date.parse(input.startUtc);
  if (!Number.isFinite(start)) throw new Error(`--start is not an ISO timestamp: ${input.startUtc}`);
  const window = {
    startUtc: new Date(start).toISOString(),
    endUtc: new Date(start + W3_WINDOW_MS).toISOString(),
    gaps: input.gaps ?? [],
  };
  const timing = readTimingLog(input.timingLog, { window, sourceRun: input.sourceRun });
  const uiLag = readUiLag(input.anomalies.anomalies, window);
  return {
    window,
    capture: { ...input.capture, normalizationKey: W3_ROUTE_NORMALIZATION_KEY },
    routeAttempts: timing.routeAttempts,
    samples: timing.samples,
    uiLag: uiLag.samples,
    uiLagUnmeasurable: uiLag.unmeasurable,
    uiLagRecordsRead: uiLag.recordsRead,
    uiLagExportShortfall: uiLagExportShortfall(input.anomalies),
    unparseableTimingLines: timing.unparseableLines,
  };
}

/**
 * By how much the ui-lag export's envelope disagrees with the array beside it.
 *
 * `GET /api/anomalies` filters first and applies `limit` afterwards, reporting
 * the matched count as `total` (`apps/daemon/src/anomaly-log.ts`). So the
 * envelope, and only the envelope, knows whether the array beside it is the whole
 * answer or one page of it — the delivered records agree with each other either
 * way. Measured on the envelope's own terms rather than on the ui-lag subset, so
 * an export taken without a `kind` filter is judged the same way.
 *
 * The invariant is equality, and the difference is signed for that reason. A
 * `total` above the array is the page boundary above; a `total` below it is an
 * envelope that contradicts its own records, which is not a shortfall of zero —
 * clamping it there would accept a file whose two halves cannot both be true.
 *
 * A `total` that is not a number is neither: it is an envelope nobody can check,
 * so it becomes a value the validator refuses.
 */
function uiLagExportShortfall(response: ListAnomaliesResponse): number {
  const delivered = response.anomalies?.length;
  if (typeof response.total !== 'number' || !Number.isFinite(response.total)) return Number.NaN;
  if (typeof delivered !== 'number') return Number.NaN;
  return response.total - delivered;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function required(argv: readonly string[], name: string): string {
  const value = flag(argv, name);
  if (value == null || value.startsWith('--')) throw new Error(`missing --${name}`);
  return value;
}

export async function runCapture(argv: readonly string[]): Promise<string> {
  const outPath = required(argv, 'out');
  // Checked here as well as in the validator, so an operator learns about a typo
  // now rather than after a 24 h window has already been spent on it.
  const requestedCachePolicy = flag(argv, 'cache-policy') ?? 'warm';
  if (!W3_CACHE_POLICIES.includes(requestedCachePolicy as W3CachePolicy)) {
    throw new Error(`--cache-policy must be one of ${W3_CACHE_POLICIES.join('|')}; got ${requestedCachePolicy}`);
  }
  const cachePolicy = requestedCachePolicy as W3CachePolicy;
  const proof = buildProof({
    timingLog: await readFile(required(argv, 'timing-log'), 'utf8'),
    anomalies: JSON.parse(await readFile(required(argv, 'anomalies'), 'utf8')) as ListAnomaliesResponse,
    startUtc: required(argv, 'start'),
    sourceRun: required(argv, 'source-run'),
    capture: {
      daemonSha: required(argv, 'daemon-sha'),
      runtimeIdentity: required(argv, 'runtime'),
      workload: required(argv, 'workload'),
      openTabCount: Number.parseInt(required(argv, 'open-tabs'), 10),
      foregroundTabExposure: required(argv, 'foreground-exposure'),
      cachePolicy,
    },
    ...(flag(argv, 'gaps') ? { gaps: JSON.parse(flag(argv, 'gaps') as string) as W3Interval[] } : {}),
  });
  await writeFile(outPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  return outPath;
}

const invokedPath = process.argv[1];
if (invokedPath != null && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  runCapture(process.argv.slice(2)).then(
    (path) => console.log(`wrote ${path}`),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
