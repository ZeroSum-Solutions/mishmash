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
// The long-task half is POLLED, not read once at the end. The anomaly log is
// size-capped and keeps one previous generation, so a 24 h window can roll it
// past what it retains; poll it through the window with each --since reaching
// back before the previous answer ended, and append each poll — paired with
// the moment it ran — to one JSON array:
//
//   { "atUtc": "<when this poll ran>", "response": <`od anomalies --kind ui-lag --json` output> }
//
// reconcileUiLagExports then merges those answers, and refuses the window when
// two consecutive polls do not overlap: the records between them left the log
// unread, and no single answer can show it. checkPollCoverage separately
// refuses a poll set whose OWN timestamps never reach both ends of the window
// — at least one poll at or before it opens and one at or after it closes —
// so a single late poll, or an empty one, cannot stand in for the whole 24 h.
//
// Run it after the capture window closes:
//
//   pnpm exec tsx lib/w3-performance-capture.ts \
//     --timing-log <data root>/request-timing/requests.jsonl \
//     --anomalies <a JSON array of timestamped ui-lag polls> \
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
  type W3SequenceGap,
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

export interface W3UiLagPoll {
  /**
   * When this export was taken — the poller's own clock, not any timestamp
   * inside the export.
   *
   * Why it is required: `reconcileUiLagExports` can only see whether
   * consecutive polls' retained sequence ranges touch. It has no way to tell a
   * poll taken once, late in the window, whose range simply has nothing
   * earlier to disagree with, from a poll that genuinely started at the
   * window's open — both look identical on sequence numbers alone (see "does
   * not read a first poll that starts above one as a gap" in the tests). That
   * distinction lives in when each poll ran, which `checkPollCoverage` checks
   * below.
   */
  atUtc: string;
  response: ListAnomaliesResponse;
}

export interface BuildProofInput {
  timingLog: string;
  /**
   * Every ui-lag export the capture polled, oldest first, each paired with
   * when it was taken.
   *
   * A 24 h window outlives the anomaly log's size cap, so one export cannot be
   * the whole answer: the operator polls `od anomalies --kind ui-lag --json
   * --since <before the previous answer ended>` and appends each poll,
   * timestamped, to this file. `buildProof` refuses the window outright unless
   * the earliest poll reaches back to (or before) `startUtc` and the latest
   * reaches (or past) the 24 h mark after it — see `checkPollCoverage`.
   */
  anomalies: readonly W3UiLagPoll[];
  /** Start of the pinned window; the end is fixed 24 h later. */
  startUtc: string;
  sourceRun: string;
  capture: Omit<W3CaptureMetadata, 'normalizationKey'>;
  /** Stretches with no observer, e.g. a daemon restart. Empty means continuous. */
  gaps?: W3Interval[];
}

/**
 * The polls themselves must prove the window was watched from open to close.
 *
 * `reconcileUiLagExports` reconciles the polls it is handed; it cannot refuse
 * a poll set that never reached one end of the window, because a single late
 * poll whose range starts above 1 is indistinguishable, on sequence numbers
 * alone, from the first poll ever taken against an established log. What must
 * additionally hold, checked here on the polls' own observation times: at
 * least one poll at or before the window opens, at least one at or after it
 * closes, and therefore at least two polls — one moment cannot be both.
 */
function checkPollCoverage(polls: readonly W3UiLagPoll[], window: W3Interval): void {
  if (polls.length === 0) {
    throw new Error(
      'no ui-lag polls were supplied; a window with no recorded observation cannot be judged for INV-3.10',
    );
  }
  if (polls.length === 1) {
    throw new Error(
      'only one ui-lag poll was supplied; a single poll cannot prove the window was watched continuously '
      + 'from open to close — poll at or before the window opens and again at or after it closes',
    );
  }
  const start = Date.parse(window.startUtc);
  const end = Date.parse(window.endUtc);
  const times = polls.map((poll) => Date.parse(poll.atUtc));
  if (times.some((time) => !Number.isFinite(time))) {
    throw new Error('a ui-lag poll carries an unparseable atUtc; its place in the window cannot be checked');
  }
  const earliest = Math.min(...times);
  const latest = Math.max(...times);
  if (earliest > start) {
    throw new Error(
      `the earliest ui-lag poll ran at ${new Date(earliest).toISOString()}, after the window opened at `
      + `${window.startUtc}; records that had already rotated out of the log before polling started would `
      + 'be invisible to every poll after them',
    );
  }
  if (latest < end) {
    throw new Error(
      `the last ui-lag poll ran at ${new Date(latest).toISOString()}, before the window closed at `
      + `${window.endUtc}; records written after polling stopped would never be read`,
    );
  }
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
  const polls = input.anomalies;
  const reconciled = reconcileUiLagExports(polls.map((poll) => poll.response));
  checkPollCoverage(polls, window);
  const uiLag = readUiLag(reconciled.records, window);
  return {
    window,
    capture: { ...input.capture, normalizationKey: W3_ROUTE_NORMALIZATION_KEY },
    routeAttempts: timing.routeAttempts,
    samples: timing.samples,
    uiLag: uiLag.samples,
    uiLagUnmeasurable: uiLag.unmeasurable,
    uiLagRecordsRead: uiLag.recordsRead,
    uiLagExportShortfall: reconciled.shortfall,
    uiLagSequenceGaps: reconciled.gaps,
    unparseableTimingLines: timing.unparseableLines,
  };
}

export interface UiLagReconciliation {
  /** Every ui-lag record the polls delivered, deduplicated, oldest sequence first. */
  records: AnomalyRecord[];
  /**
   * By how much a poll's envelope disagreed with the array beside it — the
   * disagreement of greatest magnitude across the polls, positive winning a tie.
   *
   * `GET /api/anomalies` filters first and applies `limit` afterwards, reporting
   * the matched count as `total` (`apps/daemon/src/anomaly-log.ts`). So the
   * envelope, and only the envelope, knows whether the array beside it is the
   * whole answer or one page of it — the delivered records agree with each other
   * either way. Measured on the envelope's own terms rather than on the ui-lag
   * subset, so an export taken without a `kind` filter is judged the same way.
   *
   * The invariant is equality, and the difference is signed for that reason. A
   * `total` above the array is the page boundary above; a `total` below it is an
   * envelope that contradicts its own records, which is not a shortfall of zero —
   * clamping it there would accept a file whose two halves cannot both be true.
   * The extreme rather than the sum, so one poll's page boundary cannot be
   * cancelled by another poll's opposite error.
   *
   * A `total` that is not a number is neither: it is an envelope nobody can
   * check, so it becomes a value the validator refuses.
   */
  shortfall: number;
  /** Sequence ranges no poll covered — see `W3SequenceGap`. */
  gaps: W3SequenceGap[];
}

/**
 * Merges the ordered exports one capture polled into a single ui-lag population.
 *
 * What must hold: consecutive polls OVERLAP. The anomaly log keeps one previous
 * generation, so a record leaves it for good once two rotations have passed;
 * poll `n + 1` therefore has to still retain everything poll `n` had reached, or
 * the records between them are gone and nobody asked for them. Each answer
 * declares the sequence range the log still retains, which makes that checkable:
 * the polls are continuous exactly when the next range starts no later than one
 * past the furthest sequence already read, and any daylight between the two is a
 * gap this returns by name.
 *
 * Deduplication is by record id, because overlapping polls are supposed to
 * deliver the same records twice — an overlap that double-counted its own long
 * tasks would fail INV-3.10 for the wrong reason.
 *
 * Throws on two answers it cannot honestly read. An export with no sequence range
 * at all is not a log that happened to be empty (which declares `null` and
 * reconciles fine) but an answer from a daemon that does not number its records.
 * And an export whose range ENDS below what an earlier poll already read is a
 * sequence that went backwards: either the polls were handed over out of order,
 * or the log was cleared between them and restarted its numbering
 * (`clear()` in apps/daemon/src/anomaly-log.ts). Both make every range after that
 * point refer to a different run of the numbers than the ranges before it, so a
 * gap computed across the seam would be named in numbers that mean two things.
 * Neither is reconcilable, and both are refused rather than guessed at.
 */
export function reconcileUiLagExports(polls: readonly ListAnomaliesResponse[]): UiLagReconciliation {
  const byId = new Map<string, AnomalyRecord>();
  const gaps: W3SequenceGap[] = [];
  let shortfall = 0;
  let envelopeUnreadable = false;
  let covered: number | null = null;
  let polledBefore = false;

  polls.forEach((poll, index) => {
    const delivered = Array.isArray(poll?.anomalies) ? poll.anomalies : null;
    if (delivered == null || typeof poll?.total !== 'number' || !Number.isFinite(poll.total)) {
      envelopeUnreadable = true;
    } else {
      const difference = poll.total - delivered.length;
      if (outranks(difference, shortfall)) shortfall = difference;
    }
    for (const record of delivered ?? []) byId.set(record.id, record);

    const { firstSeq, lastSeq } = poll ?? {};
    if (firstSeq === undefined || lastSeq === undefined) {
      throw new Error(
        `ui-lag export ${index + 1} of ${polls.length} carries no sequence range; `
        + 'a log whose records are not numbered cannot be reconciled across a rotation',
      );
    }
    // A log that retains nothing has nothing to reconcile against, and must not
    // reset what earlier polls already proved was read. But a null range is
    // only honest when the export really is empty: a legacy record written
    // before the daemon stamped `seq` has no sequence at all, so `firstSeq`/
    // `lastSeq` come back null even though `total` and the delivered array are
    // not. Waving that through as "the log holds nothing" would let those
    // records vanish from every check below rather than being refused.
    if (firstSeq == null || lastSeq == null) {
      const trulyEmpty = poll?.total === 0 && (delivered?.length ?? 0) === 0;
      if (!trulyEmpty) {
        throw new Error(
          `ui-lag export ${index + 1} of ${polls.length} declares no sequence range but is not empty `
          + `(total ${poll?.total}, ${delivered?.length ?? 0} record(s) delivered); legacy records written `
          + 'before the daemon numbered them cannot be reconciled across a rotation',
        );
      }
      polledBefore = true;
      return;
    }
    if (covered != null && lastSeq < covered) {
      throw new Error(
        `ui-lag export ${index + 1} of ${polls.length} ends at sequence ${lastSeq}, below the `
        + `${covered} an earlier poll had already read; the polls were handed over out of order `
        // `clear()` (apps/daemon/src/anomaly-log.ts) persists a floor and keeps
        // counting up rather than restarting at 1, so a sound daemon can no
        // longer produce this by being cleared — a genuine daemon's numbers
        // only run backwards when the polls themselves are out of sequence.
        + 'for reconciliation',
      );
    }
    if (covered == null && polledBefore && firstSeq > 1) {
      // An earlier poll found the log holding nothing. That is certain only for
      // a log that has never held ANY record: `clear()` (apps/daemon/src/
      // anomaly-log.ts) persists a floor and keeps counting up rather than
      // restarting at 1, so a poll taken while a just-cleared log is still idle
      // reports "empty" here exactly like a virgin log — the envelope alone
      // cannot tell the two apart. On a virgin log every record below
      // `firstSeq` really was written and lost inside the window; on a
      // post-clear idle log with a nonzero floor this also flags numbers below
      // that floor that were never part of this window at all. Refusing is the
      // safe direction for a measurement-integrity check, so this stays a known
      // conservative edge rather than a case this module tries to resolve
      // without seeing the floor itself.
      gaps.push({ fromSeq: 1, toSeq: firstSeq - 1 });
    }
    if (covered != null && firstSeq > covered + 1) {
      gaps.push({ fromSeq: covered + 1, toSeq: firstSeq - 1 });
    }
    covered = covered == null ? lastSeq : Math.max(covered, lastSeq);
    polledBefore = true;
  });

  const records = [...byId.values()].sort(
    (left, right) => (left.seq ?? 0) - (right.seq ?? 0) || left.at.localeCompare(right.at),
  );
  return { records, gaps, shortfall: envelopeUnreadable ? Number.NaN : shortfall };
}

/** True when `candidate` is the more serious envelope disagreement, positive winning a tie. */
function outranks(candidate: number, incumbent: number): boolean {
  if (Math.abs(candidate) !== Math.abs(incumbent)) return Math.abs(candidate) > Math.abs(incumbent);
  return candidate > incumbent;
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
    anomalies: JSON.parse(await readFile(required(argv, 'anomalies'), 'utf8')) as W3UiLagPoll[],
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
