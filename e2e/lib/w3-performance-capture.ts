// Turns one daemon request-timing log plus a `ui-lag` anomaly export into the
// pinned `W3EndpointLatencyProof` at `proof/w3/endpoint-latency-24h.json`.
//
// Two sources, because no single one can carry the proof. Endpoint durations
// come from the daemon's opt-in request-timing capture
// (`apps/daemon/src/http/request-timing-log.ts`), which records EVERY completed
// request: the anomaly log holds only failures and requests over 4 s, so a p95
// taken from it would be the p95 of the outliers. Long tasks come from
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
  W3_ROUTE_NORMALIZATION_KEY,
  W3_WINDOW_MS,
  normalizeRouteKey,
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
 * Declared here rather than imported: this is a file format read off disk, and
 * e2e may not reach into `apps/daemon/src` for a shared helper. `parseTimingRow`
 * is therefore the boundary validator — an unparseable or half-written line is
 * dropped, never guessed at.
 */
interface RequestTimingRow {
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

function parseTimingRow(line: string): RequestTimingRow | null {
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
  const row = parsed as Partial<RequestTimingRow>;
  if (typeof row.method !== 'string' || row.method === '') return null;
  if (typeof row.route !== 'string' || row.route === '') return null;
  if (typeof row.atUtc !== 'string' || !Number.isFinite(Date.parse(row.atUtc))) return null;
  if (typeof row.durationMs !== 'number' || !Number.isFinite(row.durationMs)) return null;
  if (typeof row.status !== 'number' || !Number.isFinite(row.status)) return null;
  return { method: row.method, route: row.route, status: row.status, durationMs: row.durationMs, atUtc: row.atUtc };
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
 * Attempts are counted from the same pass that writes the rows, so the two can
 * only disagree if rows were removed afterwards — which is the check the
 * validator's `dropped-failures` rule performs.
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

  for (const line of contents.split('\n')) {
    if (line.trim() === '') continue;
    const row = parseTimingRow(line);
    if (row == null) {
      unparseableLines += 1;
      continue;
    }
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

/**
 * Reads `ui-lag` records into long-task samples.
 *
 * The web writes the measured duration into the free-form `detail` object as
 * `duration_ms` (`apps/web/src/observability/anomaly-report.ts`), not as a
 * column, so a record without a numeric one carries no measurement and is not a
 * long task this proof can count.
 */
export function readUiLag(records: readonly AnomalyRecord[], window: W3Interval): W3UiLagSample[] {
  const start = Date.parse(window.startUtc);
  const end = Date.parse(window.endUtc);
  const samples: W3UiLagSample[] = [];
  for (const record of records) {
    if (record.kind !== 'ui-lag') continue;
    const at = Date.parse(record.at);
    if (!Number.isFinite(at) || at < start || at > end) continue;
    const duration = record.detail?.['duration_ms'];
    if (typeof duration !== 'number' || !Number.isFinite(duration)) continue;
    samples.push({ atUtc: record.at, durationMs: duration });
  }
  return samples;
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
  return {
    window,
    capture: { ...input.capture, normalizationKey: W3_ROUTE_NORMALIZATION_KEY },
    routeAttempts: timing.routeAttempts,
    samples: timing.samples,
    uiLag: readUiLag(input.anomalies.anomalies, window),
  };
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
  const cachePolicy = (flag(argv, 'cache-policy') ?? 'warm') as W3CaptureMetadata['cachePolicy'];
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
