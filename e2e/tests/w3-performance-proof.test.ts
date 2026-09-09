// Red spec for W3A — the 24 h endpoint-latency proof.
//
// The Wave 3 bar is a claim about a capture, not about a chart: "every
// normalized 7.2 route under 2 s p95 over 24 h, fewer than ten long tasks over
// 1 s". Every cheap way to make that claim go green is a property of the
// capture rather than of the product — drop the failures, shorten the window,
// judge a route on four samples, keep the grouped 7.2 row as one row, or time
// the browser instead of the daemon (D-21). This spec pins that
// `e2e/lib/w3-performance-proof.ts` refuses each of those and that its report
// computes per-route nearest-rank p95 and the long-task count the bar reads.
//
// The endpoint half of the fixture is grown from a golden request-timing log
// recorded off a real tools-dev daemon (`e2e/resources/w3-performance-golden.ts`), so
// the row shape under test is the one the daemon actually writes; the `ui-lag`
// half is built from the contracts `AnomalyRecord` the web already POSTs. No
// wire body is hand-written (D-18).

import { beforeAll, describe, expect, it } from 'vitest';

import type { AnomalyRecord, ListAnomaliesResponse } from '@open-design/contracts';

import { W3_REQUEST_TIMING_GOLDEN_JSONL as golden } from '../resources/w3-performance-golden.js';
import type * as ProofModule from '../lib/w3-performance-proof.js';
import type * as CaptureModule from '../lib/w3-performance-capture.js';

let proof: typeof ProofModule | null = null;
let capture: typeof CaptureModule | null = null;
let missing = '';

beforeAll(async () => {
  const reasons: string[] = [];
  try {
    proof = await import('../lib/w3-performance-proof.js');
  } catch (error) {
    reasons.push(`e2e/lib/w3-performance-proof.ts is absent: ${(error as Error).message}`);
  }
  try {
    capture = await import('../lib/w3-performance-capture.js');
  } catch (error) {
    reasons.push(`e2e/lib/w3-performance-capture.ts is absent: ${(error as Error).message}`);
  }
  missing = reasons.join('; ');
});

/** Names what is missing, so a red run reads as a diagnosis rather than a stack trace. */
function why(claim: string): string {
  return missing === '' ? claim : `${claim} — ${missing}`;
}

const WINDOW_START = '2026-09-06T09:00:00.000Z';
const WINDOW_END = '2026-09-07T09:00:00.000Z';

const CAPTURE_METADATA = {
  daemonSha: 'd3b9bd38b',
  runtimeIdentity: 'darwin arm64, node 24',
  workload: 'driven Studio use plus the scripted read loop',
  openTabCount: 2,
  foregroundTabExposure: '6 h foreground of 24 h',
  cachePolicy: 'warm' as const,
};

/**
 * The metadata a sound capture pins, including the normalization key the report
 * actually grouped by — a capture naming any other rule is mislabelled, so the
 * key cannot be a literal the fixture invents.
 */
function captureMetadata(): ProofModule.W3CaptureMetadata {
  return {
    ...CAPTURE_METADATA,
    normalizationKey: proof?.W3_ROUTE_NORMALIZATION_KEY ?? '<no normalization key on this revision>',
  };
}

/** The proof shape, typed only where the module under test is present. */
type Proof = ProofModule.W3EndpointLatencyProof;
type Sample = ProofModule.W3LatencySample;
type W3CaptureMetadata = ProofModule.W3CaptureMetadata;

/**
 * The validator's verdict, or a sentinel naming what is missing.
 *
 * A sentinel rather than an empty list: with no module present, an empty list
 * would let "a sound capture raises no violation" pass vacuously, and a case
 * that cannot fail proves nothing.
 */
function violationCodes(candidate: Proof): string[] {
  if (proof == null) return ['<no validator on this revision>'];
  return proof.validateProof(candidate).map((violation) => violation.code);
}

function requiredRoutes(): ReadonlyArray<{ method: string; route: string }> {
  return proof?.W3_REQUIRED_ROUTES ?? [];
}

/**
 * A capture that passes on every axis, so a test that adds one defect is
 * measuring that defect alone.
 */
function healthyProof(overrides: Partial<Proof> = {}): Proof {
  const samples: Sample[] = [];
  for (const required of requiredRoutes()) {
    for (let index = 0; index < 30; index += 1) {
      samples.push({
        method: required.method,
        route: required.route,
        // Well inside the 2 s budget, and varied so a percentile is meaningful.
        durationMs: 40 + index * 3,
        atUtc: new Date(Date.parse(WINDOW_START) + index * 60_000).toISOString(),
        outcome: 'success',
        status: 200,
        sourceRun: 'fixture',
        source: 'daemon',
      });
    }
  }
  const merged = {
    window: { startUtc: WINDOW_START, endUtc: WINDOW_END, gaps: [] },
    capture: captureMetadata(),
    routeAttempts: requiredRoutes().map((required) => ({
      ...required,
      source: 'daemon' as const,
      attempts: 30,
    })),
    samples,
    uiLag: [] as ProofModule.W3UiLagSample[],
    uiLagUnmeasurable: 0,
    uiLagExportShortfall: 0,
    uiLagSequenceGaps: [] as ProofModule.W3SequenceGap[],
    unparseableTimingLines: 0,
    ...overrides,
  };
  return {
    // Derived, not written: a fixture whose ui-lag denominator disagreed with its own
    // rows by accident would make every other case fight a violation it did not mean
    // to raise. A case that wants the disagreement sets the field itself.
    uiLagRecordsRead: merged.uiLag.length + merged.uiLagUnmeasurable,
    ...merged,
  } as Proof;
}

function uiLagRecord(at: string, durationMs: number, seq?: number): AnomalyRecord {
  return {
    id: `ui-lag-${at}`,
    ...(seq == null ? {} : { seq }),
    at,
    kind: 'ui-lag',
    severity: 'warn',
    source: 'web',
    summary: `Main thread blocked for ${durationMs}ms`,
    detail: { safetyEvent: 'client_long_task', duration_ms: durationMs },
  };
}

/**
 * One `GET /api/anomalies` answer, in the envelope the daemon returns.
 *
 * The envelope is where a rotation becomes visible: `total` says whether the
 * array beside it is the whole match, and the sequence range says which records
 * the log still retains. Built here rather than written per case so no fixture
 * can accidentally describe an answer the daemon could not produce (D-18).
 */
function uiLagExport(
  records: readonly AnomalyRecord[],
  overrides: Partial<ListAnomaliesResponse> = {},
): ListAnomaliesResponse {
  const sequences = records
    .map((record) => record.seq)
    .filter((seq): seq is number => typeof seq === 'number');
  const lastSeq = sequences.length === 0 ? null : Math.max(...sequences);
  return {
    anomalies: [...records],
    total: records.length,
    path: '/dev/null',
    firstSeq: sequences.length === 0 ? null : Math.min(...sequences),
    lastSeq,
    generations: 1,
    // Matches what a sound daemon reports whenever nothing has ever been
    // cleared: `highWaterSeq` equals the highest retained sequence, since
    // there is no persisted floor above it. A case that wants to describe a
    // clear having advanced the floor past what is currently retained sets
    // this explicitly via `overrides`.
    highWaterSeq: lastSeq ?? 0,
    ...overrides,
  };
}

/**
 * Wraps a single export as the two timestamped polls `buildProof` now
 * requires, both taken at the window's boundaries.
 *
 * Polling the SAME content at open and close is a legitimate minimal capture
 * — nothing changed between the two, so there is nothing to reconcile beyond
 * what `uiLagExport` already describes. Cases below that are about the polls
 * THEMSELVES (coverage, or reconciling a genuine rotation) build
 * `CaptureModule.W3UiLagPoll[]` directly instead of using this helper.
 */
function spanning(response: ListAnomaliesResponse): CaptureModule.W3UiLagPoll[] {
  return [
    { atUtc: WINDOW_START, response },
    { atUtc: WINDOW_END, response },
  ];
}

/**
 * Times an ordered sequence of raw exports evenly across the window, first at
 * `WINDOW_START` and last at `WINDOW_END`.
 *
 * Every case in the rotation `describe` block below is about what the
 * SEQUENCE-RANGE reconciliation does with a given ordered poll sequence, not
 * about poll coverage — bracketing them at the window's edges satisfies
 * `checkPollCoverage` trivially so each case still measures only the thing it
 * names.
 */
function toPolls(responses: readonly ListAnomaliesResponse[]): CaptureModule.W3UiLagPoll[] {
  const start = Date.parse(WINDOW_START);
  const end = Date.parse(WINDOW_END);
  return responses.map((response, index) => ({
    atUtc: new Date(
      responses.length <= 1 ? start : start + ((end - start) * index) / (responses.length - 1),
    ).toISOString(),
    response,
  }));
}

describe('W3 endpoint-latency proof — validator', () => {
  it('accepts a complete, continuous, daemon-timed capture', () => {
    expect(violationCodes(healthyProof()), why('a sound capture must raise no violation')).toEqual([]);
  });

  it('rejects a capture with no row for a route the bar judges', () => {
    const candidate = healthyProof();
    const dropped = candidate.samples.filter((sample) => sample.route !== '/api/connectors/discovery');
    const codes = violationCodes({ ...candidate, samples: dropped });

    expect(codes, why('a required 7.2/D-20 route with no row must be refused')).toContain(
      'missing-route-row',
    );
  });

  it('rejects a route judged on fewer than thirty successful samples', () => {
    const candidate = healthyProof();
    const thinned = candidate.samples.filter(
      (sample) => sample.route !== '/api/agents' || sample.durationMs < 100,
    );
    const codes = violationCodes({ ...candidate, samples: thinned });

    expect(codes, why('under thirty successful samples a route is not judged, it is INSUFFICIENT')).toContain(
      'insufficient-samples',
    );
  });

  it('rejects an outcome outside the closed set', () => {
    const candidate = healthyProof();
    const [first, ...rest] = candidate.samples;
    const codes = violationCodes({
      ...candidate,
      samples: [{ ...(first as Sample), outcome: 'degraded' as Sample['outcome'] }, ...rest],
    });

    expect(codes, why('an invented outcome is how a failure is smuggled past a reader')).toContain(
      'unknown-outcome',
    );
  });

  it('rejects a capture whose rows are fewer than the observations it attempted', () => {
    const candidate = healthyProof();
    const codes = violationCodes({
      ...candidate,
      // Thirty-five observations counted at the source, thirty rows in the
      // file: five went missing between the attempt and the write.
      routeAttempts: candidate.routeAttempts.map((entry) =>
        entry.route === '/api/projects' ? { ...entry, attempts: 35 } : entry,
      ),
    });

    expect(codes, why('rows dropped after the attempt was counted are censored failures')).toContain(
      'dropped-failures',
    );
  });

  it('does not let client-observed rows stand in for daemon rows that went missing', () => {
    const candidate = healthyProof();
    const codes = violationCodes({
      ...candidate,
      routeAttempts: candidate.routeAttempts.map((entry) =>
        entry.route === '/api/projects' ? { ...entry, attempts: 35 } : entry,
      ),
      // Five browser rows arrive for the same route. Counted together with the
      // daemon rows the totals would balance, and the five missing daemon
      // observations would disappear — so each observer is accounted alone.
      samples: [
        ...candidate.samples,
        ...Array.from({ length: 5 }, (_unused, index) => ({
          method: 'GET',
          route: '/api/projects',
          durationMs: 500 + index,
          atUtc: new Date(Date.parse(WINDOW_START) + index * 1_000).toISOString(),
          outcome: 'success' as const,
          status: 200,
          sourceRun: 'fixture',
          source: 'web' as const,
        })),
      ],
    });

    expect(codes, why('a censored daemon row cannot be padded from the browser')).toContain(
      'dropped-failures',
    );
  });

  it('rejects a judged route whose daemon rows declare no attempt count', () => {
    const candidate = healthyProof();
    const codes = violationCodes({
      ...candidate,
      // Deleting the attempts entry is the cheapest way to censor: with nothing
      // to compare the written rows against, dropped rows leave no trace.
      routeAttempts: candidate.routeAttempts.filter((entry) => entry.route !== '/api/projects'),
    });

    expect(codes, why('rows with no declared attempts cannot be checked for censoring')).toContain(
      'missing-route-attempts',
    );
  });

  it('rejects a long task recorded outside the pinned interval', () => {
    const codes = violationCodes(
      healthyProof({ uiLag: [{ atUtc: '2026-09-05T23:00:00.000Z', durationMs: 4_000 }] }),
    );

    // INV-3.10 is judged over the pinned interval, so an entry the window does
    // not cover must be refused rather than counted against the bar.
    expect(codes, why('the ui-lag interval is the pinned window, not the export')).toContain(
      'sample-outside-window',
    );
  });

  it('rejects a capture that could not measure a long task it recorded', () => {
    const codes = violationCodes(healthyProof({ uiLagUnmeasurable: 2 } as Partial<Proof>));

    // A ui-lag row whose duration the reader could not read is exactly the row
    // that might have been over the bar; dropping it silently is censoring.
    expect(codes, why('an unmeasurable long task may not vanish from the count')).toContain(
      'unmeasurable-ui-lag',
    );
  });

  it('rejects a capture that deleted its unmeasurable-long-task count', () => {
    const candidate = healthyProof();
    const { uiLagUnmeasurable: _dropped, ...withoutCount } = candidate;
    const codes = violationCodes(withoutCount as Proof);

    // Deleting the count is cheaper than deleting the records: an absent
    // denominator reads as zero, which is the same hole `missing-route-attempts`
    // closes for the endpoint half.
    expect(codes, why('an absent unmeasurable count is not a count of zero')).toContain(
      'unmeasurable-ui-lag',
    );
  });

  it('rejects a cache policy outside the closed set', () => {
    const codes = violationCodes(
      healthyProof({
        capture: { ...captureMetadata(), cachePolicy: 'hot' as W3CaptureMetadata['cachePolicy'] },
      }),
    );

    // Cold and warm are different measurements of the same route, so a policy
    // nobody defined leaves the reader unable to say which one they are reading.
    expect(codes, why('a cache policy must be one the reader can interpret')).toContain(
      'missing-capture-metadata',
    );
  });

  it('rejects a capture that deleted its ui-lag record count', () => {
    const candidate = healthyProof({ uiLag: [{ atUtc: WINDOW_START, durationMs: 1_800 }] });
    const { uiLagRecordsRead: _dropped, ...withoutCount } = candidate;
    const codes = violationCodes(withoutCount as Proof);

    expect(codes, why('an absent ui-lag denominator is not a denominator of zero')).toContain(
      'dropped-ui-lag',
    );
  });

  it('rejects a capture that dropped a long task after reading it', () => {
    const codes = violationCodes(
      healthyProof({
        uiLag: [
          { atUtc: WINDOW_START, durationMs: 1_800 },
          { atUtc: WINDOW_START, durationMs: 1_900 },
        ],
        // Five ui-lag records were read in the window; two rows reached the file
        // and none was unmeasurable, so three long tasks went missing between
        // the read and the write. Without a denominator this is invisible: the
        // count simply drops and a failing capture reads as a pass.
        uiLagRecordsRead: 5,
      } as Partial<Proof>),
    );

    expect(codes, why('long tasks dropped after they were read are censored')).toContain(
      'dropped-ui-lag',
    );
  });

  it('rejects a capture whose ui-lag export was a truncated page of its own query', () => {
    const codes = violationCodes(healthyProof({ uiLagExportShortfall: 3 } as Partial<Proof>));

    // `GET /api/anomalies` applies `limit` AFTER matching, and reports the matched
    // count as `total` (apps/daemon/src/anomaly-log.ts). An export that delivered
    // fewer records than it matched is a page, not a window: the records it left
    // behind are invisible to every other check, because the ones it DID deliver
    // are perfectly self-consistent with each other.
    expect(codes, why('a truncated ui-lag export undercounts INV-3.10 silently')).toContain(
      'truncated-ui-lag-export',
    );
  });

  it('rejects a capture that deleted its ui-lag export shortfall', () => {
    const candidate = healthyProof();
    const { uiLagExportShortfall: _dropped, ...withoutShortfall } = candidate;
    const codes = violationCodes(withoutShortfall as Proof);

    expect(codes, why('an absent shortfall is not a shortfall of zero')).toContain(
      'truncated-ui-lag-export',
    );
  });

  it('rejects a capture with a torn timing-log line', () => {
    const codes = violationCodes(healthyProof({ unparseableTimingLines: 2 } as Partial<Proof>));

    // A daemon killed mid-append leaves a half-written row. The reader drops it
    // from the rows AND from the attempts in the same pass, so the capture stays
    // internally consistent while its population quietly shrinks — the endpoint
    // half of exactly what `uiLagUnmeasurable` refuses on the long-task half.
    expect(codes, why('a torn timing row is a lost observation, not an absent one')).toContain(
      'unparseable-timing-line',
    );
  });

  it('rejects a capture that deleted its torn-line count', () => {
    const candidate = healthyProof();
    const { unparseableTimingLines: _dropped, ...withoutCount } = candidate;
    const codes = violationCodes(withoutCount as Proof);

    expect(codes, why('an absent torn-line count is not a count of zero')).toContain(
      'unparseable-timing-line',
    );
  });

  it('rejects a window that is not exactly twenty-four hours', () => {
    const codes = violationCodes(
      healthyProof({
        window: { startUtc: WINDOW_START, endUtc: '2026-09-07T05:00:00.000Z', gaps: [] },
      }),
    );

    expect(codes, why('a short window is a smaller bar, not the same bar')).toContain('window-not-24h');
  });

  it('rejects a window with a declared gap', () => {
    const codes = violationCodes(
      healthyProof({
        window: {
          startUtc: WINDOW_START,
          endUtc: WINDOW_END,
          gaps: [{ startUtc: '2026-09-06T12:00:00.000Z', endUtc: '2026-09-06T14:00:00.000Z' }],
        },
      }),
    );

    expect(codes, why('a stretch with no observer makes the capture discontinuous')).toContain(
      'window-not-continuous',
    );
  });

  it('rejects a negative duration', () => {
    const candidate = healthyProof();
    const [first, ...rest] = candidate.samples;
    const codes = violationCodes({
      ...candidate,
      samples: [{ ...(first as Sample), durationMs: -12 }, ...rest],
    });

    expect(codes, why('a negative duration is not a measurement')).toContain('negative-duration');
  });

  it('rejects a stream sample whose frame was never typed', () => {
    const candidate = healthyProof();
    const codes = violationCodes({
      ...candidate,
      samples: [
        ...candidate.samples,
        {
          method: 'GET',
          route: '/api/agents',
          durationMs: 120,
          atUtc: WINDOW_START,
          outcome: 'success',
          status: 200,
          sourceRun: 'fixture',
          source: 'daemon',
          stream: true,
        } as Sample,
      ],
    });

    expect(codes, why('an untyped SSE frame pins nothing about what the daemon sent')).toContain(
      'untyped-stream-frame',
    );
  });

  it('rejects a route timed only in the browser', () => {
    const candidate = healthyProof();
    const webOnly = candidate.samples.map((sample) =>
      sample.route === '/api/design-systems' ? { ...sample, source: 'web' as const } : sample,
    );
    const codes = violationCodes({ ...candidate, samples: webOnly });

    // D-21: a browser row carries per-host connection queueing, so its p95
    // measures the tab's socket budget rather than the handler.
    expect(codes, why('client-observed rows alone cannot set a route p95')).toContain('web-only-route');
  });

  it('rejects a capture that does not pin how it was taken', () => {
    const codes = violationCodes(
      healthyProof({ capture: { ...captureMetadata(), daemonSha: '', openTabCount: Number.NaN } }),
    );

    expect(codes, why('an unpinned capture cannot be reproduced or disputed')).toContain(
      'missing-capture-metadata',
    );
  });

  it('rejects a capture whose pinned normalization key is not the rule it grouped by', () => {
    const codes = violationCodes(
      healthyProof({
        capture: { ...captureMetadata(), normalizationKey: 'ids collapsed, splats kept apart' },
      }),
    );

    // Grouping always runs `normalizeRouteKey`, so a key naming another rule
    // does not change a number — it mislabels every number in the file.
    expect(codes, why('a capture may not name a grouping rule it did not use')).toContain(
      'missing-capture-metadata',
    );
  });

  it('collapses the several spellings one endpoint reaches the capture under', () => {
    const normalize = proof?.normalizeRouteKey ?? (() => '');

    // The message PUT's "two spellings" from the 7.2 table: the Express pattern
    // the daemon records when a route matched, and the concrete path the
    // browser knows. Left apart they are two rows, each under the sample floor.
    expect(
      normalize('PUT', '/api/projects/:id/conversations/:cid/messages/:mid'),
      why('the daemon and browser spellings of one endpoint must land on one row'),
    ).toBe(
      normalize(
        'put',
        '/api/projects/8d3e5d24-02f1-45ac-972b-8f5f732add04/conversations/7e3c1051-1a7f-4374-ab54-740dd3410750/messages/6036ec55-d58a-4bfc-9b20-e61fa320e5f9',
      ),
    );
    // Express 5 spells a splat `*splat`; D-20 names these rows with a bare `*`.
    expect(normalize('GET', '/api/skills/:id/assets/*splat')).toBe('GET /api/skills/:id/assets/*');
    expect(normalize('GET', '/api/integrations/vela/message-center/*splat')).toBe(
      'GET /api/integrations/vela/message-center/messages',
    );
  });

  it('requires the grouped 7.2 row as five independently judged rows', () => {
    const routes = requiredRoutes().map((required) => `${required.method} ${required.route}`);

    expect(routes, why('DEF-3.4: one slow member must not hide inside a grouped row')).toEqual(
      expect.arrayContaining([
        'GET /api/skills',
        'GET /api/prompt-templates',
        'GET /api/recent-dirs',
        'GET /api/analytics/config',
        'GET /api/media/config',
      ]),
    );
    // The SSE stream is excluded: its duration measures how long a reader kept
    // it open, not how fast the daemon answered.
    expect(routes).not.toContain('GET /api/runs/:id/events');
  });
});

describe('W3 endpoint-latency proof — report', () => {
  it('computes nearest-rank p95 per route and fails the bar on a slow one', () => {
    const candidate = healthyProof();
    const slow = candidate.samples.map((sample) =>
      sample.route === '/api/projects/:id/files' ? { ...sample, durationMs: 2_400 } : sample,
    );
    const report = proof?.reportProof({ ...candidate, samples: slow });
    const files = report?.routes.find((row) => row.route === '/api/projects/:id/files');
    const agents = report?.routes.find((row) => row.route === '/api/agents');

    expect(files?.verdict, why('a route whose p95 reaches 2 s fails INV-3.1')).toBe('FAIL');
    expect(files?.daemonP95Ms).toBe(2_400);
    // Nearest-rank over 40..127 in steps of three: index ceil(30 * 0.95) - 1 = 28.
    expect(agents?.daemonP95Ms, why('p95 must use the page-load benchmark rule')).toBe(124);
    expect(agents?.verdict).toBe('PASS');
    expect(report?.inv31).toBe('FAIL');
    expect(report?.passed).toBe(false);
  });

  it('reads a thin route as INSUFFICIENT and fails the bar on it', () => {
    const candidate = healthyProof();
    const thinned = candidate.samples.filter(
      (sample) => sample.route !== '/api/connectors' || sample.durationMs < 70,
    );
    const report = proof?.reportProof({ ...candidate, samples: thinned });
    const connectors = report?.routes.find((row) => row.route === '/api/connectors');

    expect(connectors?.verdict, why('INSUFFICIENT is not PASS')).toBe('INSUFFICIENT');
    expect(report?.inv31).toBe('FAIL');
  });

  it('records attempts, outcomes and statuses beside the successful-sample p95', () => {
    const candidate = healthyProof();
    const withFailures: Sample[] = [
      ...candidate.samples,
      ...[503, 503, 404].map((status, index) => ({
        method: 'GET',
        route: '/api/live-artifacts',
        durationMs: 90,
        atUtc: new Date(Date.parse(WINDOW_START) + (200 + index) * 1_000).toISOString(),
        outcome: status >= 500 ? ('server-error' as const) : ('client-error' as const),
        status,
        sourceRun: 'fixture',
        source: 'daemon' as const,
      })),
    ];
    const report = proof?.reportProof({
      ...candidate,
      routeAttempts: candidate.routeAttempts.map((entry) =>
        entry.route === '/api/live-artifacts' ? { ...entry, attempts: 33 } : entry,
      ),
      samples: withFailures,
    });
    const live = report?.routes.find((row) => row.route === '/api/live-artifacts');

    // An availability failure must not hide behind "successful only".
    expect(live?.attempts, why('attempts, statuses and failures are reported per route')).toBe(33);
    expect(live?.failures).toBe(3);
    expect(live?.outcomeCounts['server-error']).toBe(2);
    expect(live?.statusCounts['503']).toBe(2);
    expect(live?.successfulSamples).toBe(30);
  });

  it('reports the browser-observed p95 separately from the one that is judged', () => {
    const candidate = healthyProof();
    const withWebRows: Sample[] = [
      ...candidate.samples,
      ...Array.from({ length: 30 }, (_unused, index) => ({
        method: 'GET',
        route: '/api/agents',
        // A queued browser observation of the same fast handler (D-21).
        durationMs: 60_000 + index,
        atUtc: new Date(Date.parse(WINDOW_START) + index * 1_000).toISOString(),
        outcome: 'success' as const,
        status: 200,
        sourceRun: 'fixture',
        source: 'web' as const,
      })),
    ];
    const report = proof?.reportProof({ ...candidate, samples: withWebRows });
    const agents = report?.routes.find((row) => row.route === '/api/agents');

    expect(agents?.verdict, why('browser queueing must not decide a route verdict')).toBe('PASS');
    expect(agents?.daemonP95Ms).toBe(124);
    expect(agents?.clientObservedP95Ms).toBe(60_028);
  });

  it('counts long tasks over 1 s in the pinned interval and splits them by UTC day', () => {
    const records: AnomalyRecord[] = [
      uiLagRecord('2026-09-06T10:00:00.000Z', 1_200),
      uiLagRecord('2026-09-06T11:00:00.000Z', 999),
      uiLagRecord('2026-09-06T12:00:00.000Z', 1_000),
      uiLagRecord('2026-09-07T01:00:00.000Z', 4_800),
      // Outside the pinned interval: the bar is the window, not the calendar.
      uiLagRecord('2026-09-05T23:00:00.000Z', 9_000),
    ];
    const response: ListAnomaliesResponse = uiLagExport(records);
    const read = capture?.readUiLag(records, { startUtc: WINDOW_START, endUtc: WINDOW_END });
    const uiLag = read?.samples ?? [];
    const report = proof?.reportProof(healthyProof({ uiLag }));

    expect(response.total).toBe(5);
    // Strictly over 1,000 ms: 999 and an exact 1,000 are not long tasks.
    expect(uiLag.length, why('ui-lag durations live in detail.duration_ms, not a column')).toBe(4);
    expect(read?.unmeasurable, why('every record in this export carried a duration')).toBe(0);
    expect(report?.uiLagOverThreshold, why('INV-3.10 counts over the pinned interval')).toBe(2);
    expect(report?.uiLagByUtcDay).toEqual([
      { day: '2026-09-06', overThreshold: 1 },
      { day: '2026-09-07', overThreshold: 1 },
    ]);
    expect(report?.inv310).toBe('PASS');
  });

  it('counts a ui-lag record it cannot measure rather than dropping it', () => {
    const stripped: AnomalyRecord = {
      id: 'ui-lag-no-duration',
      at: '2026-09-06T10:00:00.000Z',
      kind: 'ui-lag',
      severity: 'warn',
      source: 'web',
      summary: 'Main thread blocked for ?ms',
      detail: { safetyEvent: 'client_long_task' },
    };
    const read = capture?.readUiLag([stripped, uiLagRecord('2026-09-06T11:00:00.000Z', 2_000)], {
      startUtc: WINDOW_START,
      endUtc: WINDOW_END,
    });

    // The web always writes duration_ms today, so a record without one is
    // itself anomalous — and it is precisely the row that might have been over
    // the bar. A reader that skips it censors the count it is reporting.
    expect(read?.samples.length, why('a measured record still counts')).toBe(1);
    expect(read?.unmeasurable, why('a ui-lag row with no duration must be surfaced')).toBe(1);
  });

  it('fails INV-3.10 at ten long tasks in the interval', () => {
    const uiLag = Array.from({ length: 10 }, (_unused, index) => ({
      atUtc: new Date(Date.parse(WINDOW_START) + index * 3_600_000).toISOString(),
      durationMs: 1_500,
    }));
    const report = proof?.reportProof(healthyProof({ uiLag }));

    expect(report?.inv310, why('the bar is fewer than ten, so ten fails')).toBe('FAIL');
    expect(report?.passed).toBe(false);
  });

  it('passes the bar only on a capture that could have failed it', () => {
    const report = proof?.reportProof(healthyProof({ uiLag: [{ atUtc: WINDOW_START, durationMs: 1_800 }] }));

    expect(report?.violations, why('a PASS requires a sound capture')).toEqual([]);
    expect(report?.routes.every((row) => row.verdict === 'PASS')).toBe(true);
    expect(report?.passed).toBe(true);
  });
});

describe('W3 endpoint-latency proof — capture from a real daemon recording', () => {
  it('parses the golden request-timing log the daemon writes', () => {
    const result = capture?.readTimingLog(golden, {
      window: { startUtc: '2020-01-01T00:00:00.000Z', endUtc: '2099-01-01T00:00:00.000Z' },
      sourceRun: 'golden',
    });

    expect(result?.unparseableLines, why('every recorded line must parse')).toBe(0);
    expect((result?.samples.length ?? 0) > 0).toBe(true);
    // The recording was taken against real routes, so it must normalize onto
    // rows the bar judges rather than onto strings nobody grouped on.
    const keys = new Set(
      (result?.samples ?? []).map((sample) => `${sample.method} ${sample.route}`),
    );
    expect([...keys], why('the recording must land on routes the bar judges')).toEqual(
      expect.arrayContaining(['GET /api/agents', 'GET /api/skills', 'GET /api/connectors']),
    );
    expect(result?.routeAttempts.every((entry) => entry.attempts > 0)).toBe(true);
    for (const sample of result?.samples ?? []) {
      expect(sample.source).toBe('daemon');
      expect(sample.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('derives outcomes from status without dropping a failure', () => {
    const derive = capture?.outcomeForStatus ?? (() => 'success');

    expect(derive(200), why('the closed outcome set is derived, never assumed')).toBe('success');
    expect(derive(404)).toBe('client-error');
    expect(derive(503)).toBe('server-error');
    expect(derive(0)).toBe('unreachable');
  });

  it('carries the shortfall of a truncated ui-lag export into the proof', () => {
    const delivered = [uiLagRecord('2026-09-06T10:00:00.000Z', 1_200, 1)];
    const built = capture?.buildProof({
      timingLog: golden,
      // The envelope says five ui-lag records matched the query and hands back one:
      // `GET /api/anomalies` applied a `limit` the operator did not widen.
      anomalies: spanning(uiLagExport(delivered, { total: 5 })),
      startUtc: WINDOW_START,
      sourceRun: 'golden',
      capture: { ...CAPTURE_METADATA },
    });

    expect(built?.uiLagExportShortfall, why('the export declared more records than it delivered')).toBe(4);
    expect(violationCodes(built as Proof)).toContain('truncated-ui-lag-export');
  });

  it('does not read a window filter as a truncated export', () => {
    // Every matched record was delivered; four of the five simply fall outside the
    // pinned window. That is the capture doing its job, not a page boundary, so it
    // must not raise the truncation violation.
    const records = [
      uiLagRecord('2026-09-06T10:00:00.000Z', 1_200, 5),
      uiLagRecord('2020-01-01T00:00:00.000Z', 1_200, 1),
      uiLagRecord('2020-01-02T00:00:00.000Z', 1_200, 2),
      uiLagRecord('2020-01-03T00:00:00.000Z', 1_200, 3),
      uiLagRecord('2020-01-04T00:00:00.000Z', 1_200, 4),
    ];
    const built = capture?.buildProof({
      timingLog: golden,
      anomalies: spanning(uiLagExport(records)),
      startUtc: WINDOW_START,
      sourceRun: 'golden',
      capture: { ...CAPTURE_METADATA },
    });

    expect(built?.uiLagExportShortfall, why('an out-of-window record was still delivered')).toBe(0);
    expect(violationCodes(built as Proof)).not.toContain('truncated-ui-lag-export');
  });

  it('counts an attempt with no terminal row as an unreachable observation', () => {
    // A daemon killed mid-request leaves exactly this: the entry row it already
    // wrote, and no terminal row beside it. Made by deleting one recorded
    // terminal line from the golden rather than by writing a row by hand.
    const lines = golden.split('\n').filter((line) => line.trim() !== '');
    const orphanedId = 'ba352d71-5';
    const kept = lines.filter(
      (line) => !(line.includes(`"${orphanedId}"`) && line.includes('"phase":"end"')),
    );
    const result = capture?.readTimingLog(kept.join('\n'), {
      window: { startUtc: '2020-01-01T00:00:00.000Z', endUtc: '2099-01-01T00:00:00.000Z' },
      sourceRun: 'golden',
    });

    // Never dropped: an attempt nobody answered is the observation the whole
    // journal exists to make visible, so it is carried as a status-0 row and
    // counted in its route's attempts like any other.
    expect(result?.unparseableLines, why('an entry row is a row, not a torn line')).toBe(0);
    const unreachable = (result?.samples ?? []).filter((sample) => sample.status === 0);
    expect(unreachable.length, why('an unterminated attempt must survive into the samples')).toBe(2);
    expect(unreachable.every((sample) => sample.outcome === 'unreachable')).toBe(true);
    // Three GETs to /api/skills were recorded; deleting one terminal row must
    // not turn three attempts into two.
    const skills = (result?.routeAttempts ?? []).find((entry) => entry.route === '/api/skills');
    const skillRows = (result?.samples ?? []).filter((sample) => sample.route === '/api/skills');
    expect(skills?.attempts, why('the unterminated attempt is still an attempt')).toBe(3);
    expect(skillRows.length, why('and it is still a row')).toBe(3);
  });

  it('reads the aborted attempt the recording holds as an unreachable row', () => {
    const result = capture?.readTimingLog(golden, {
      window: { startUtc: '2020-01-01T00:00:00.000Z', endUtc: '2099-01-01T00:00:00.000Z' },
      sourceRun: 'golden',
    });

    // The recording contains one GET the client aborted before any byte went
    // out. It is the never-answered condition 3D fixes, and before the journal
    // it left no row at all — thirty healthy completions on the same route with
    // no sign that anything had failed.
    const aborted = (result?.samples ?? []).filter(
      (sample) => sample.route === '/api/agents' && sample.outcome === 'unreachable',
    );
    expect(aborted.length, why('the recorded abort must reach the capture')).toBe(1);
    expect(aborted[0]?.status).toBe(0);
    expect(aborted[0]?.durationMs).toBeGreaterThan(0);
  });

  it('refuses a ui-lag export whose envelope disagrees with the array beside it', () => {
    const delivered = [
      uiLagRecord('2026-09-06T10:00:00.000Z', 1_200, 1),
      uiLagRecord('2026-09-06T11:00:00.000Z', 1_200, 2),
      uiLagRecord('2026-09-06T12:00:00.000Z', 1_200, 3),
    ];
    const built = capture?.buildProof({
      timingLog: golden,
      // `total` is the matched count and the array is what was handed over, so
      // the two must be equal or the export is not a whole answer. A `total`
      // BELOW the array length is an envelope nobody can reconcile with its own
      // records; reading it as a shortfall of zero accepts a file whose two
      // halves contradict each other.
      anomalies: spanning(uiLagExport(delivered, { total: 1 })),
      startUtc: WINDOW_START,
      sourceRun: 'golden',
      capture: { ...CAPTURE_METADATA },
    });

    expect(violationCodes(built as Proof), why('total must equal the delivered array length')).toContain(
      'truncated-ui-lag-export',
    );
  });

  it('carries a torn timing-log line into the proof rather than dropping it', () => {
    // A killed daemon's half-written row, made by cutting a real recorded line
    // short rather than by inventing one.
    const recorded = golden.split('\n').filter((line) => line.trim() !== '');
    const torn = `${(recorded[1] as string).slice(0, 40)}\n`;
    const built = capture?.buildProof({
      timingLog: golden + torn,
      anomalies: spanning(uiLagExport([])),
      startUtc: WINDOW_START,
      sourceRun: 'golden',
      capture: { ...CAPTURE_METADATA },
    });

    expect(built?.unparseableTimingLines, why('a torn row must reach the artefact')).toBe(1);
    expect(violationCodes(built as Proof)).toContain('unparseable-timing-line');
  });

  it('builds a proof whose window is exactly 24 h from the recorded rows', () => {
    const built = capture?.buildProof({
      timingLog: golden,
      anomalies: spanning(uiLagExport([])),
      startUtc: WINDOW_START,
      sourceRun: 'golden',
      capture: {
        daemonSha: CAPTURE_METADATA.daemonSha,
        runtimeIdentity: CAPTURE_METADATA.runtimeIdentity,
        workload: CAPTURE_METADATA.workload,
        openTabCount: CAPTURE_METADATA.openTabCount,
        foregroundTabExposure: CAPTURE_METADATA.foregroundTabExposure,
        cachePolicy: CAPTURE_METADATA.cachePolicy,
      },
    });

    expect(built?.window.endUtc, why('the capture script pins the 24 h window itself')).toBe(WINDOW_END);
    expect(built?.capture.normalizationKey).toBe(proof?.W3_ROUTE_NORMALIZATION_KEY);
    // The recording predates the pinned window, so a fresh build holds no rows —
    // and the validator says so rather than reporting an empty table as a pass.
    expect(violationCodes(built as Proof)).toContain('missing-route-row');
  });
});

describe('W3 endpoint-latency proof — ui-lag polls across an anomaly-log rotation', () => {
  /** A `ui-lag` record inside the pinned window, numbered as the daemon numbers it. */
  function lagAt(minutes: number, seq: number, durationMs = 1_200): AnomalyRecord {
    const at = new Date(Date.parse(WINDOW_START) + minutes * 60_000).toISOString();
    return uiLagRecord(at, durationMs, seq);
  }

  /**
   * The proof one ordered sequence of polls builds, or null when this revision
   * cannot reconcile a poll sequence at all.
   */
  function buildFromPolls(polls: readonly ListAnomaliesResponse[]): Proof | null {
    try {
      return (
        capture?.buildProof({
          timingLog: golden,
          // Bracketed at the window's edges (see `toPolls`) so every case here
          // measures the sequence-range reconciliation alone, not poll coverage.
          anomalies: toPolls(polls),
          startUtc: WINDOW_START,
          sourceRun: 'golden',
          capture: { ...CAPTURE_METADATA },
        }) ?? null
      );
    } catch {
      return null;
    }
  }

  /** The same build, letting the capture's boundary refusals through to the caller. */
  function buildOrThrow(polls: readonly ListAnomaliesResponse[]): Proof | undefined {
    return capture?.buildProof({
      timingLog: golden,
      anomalies: toPolls(polls),
      startUtc: WINDOW_START,
      sourceRun: 'golden',
      capture: { ...CAPTURE_METADATA },
    });
  }

  /**
   * The sequence ranges a built capture declares it never read, as `from..to`.
   *
   * A sentinel rather than an empty list when nothing can be read: an empty list
   * is the shape of "the polls covered everything", so returning it for a
   * revision that cannot reconcile polls would let the accepting case below pass
   * vacuously.
   */
  function gapRanges(candidate: Proof | null): string[] {
    const gaps = candidate?.uiLagSequenceGaps;
    if (!Array.isArray(gaps)) return ['<this revision does not reconcile a ui-lag poll sequence>'];
    return gaps.map((gap: ProofModule.W3SequenceGap) => `${gap.fromSeq}..${gap.toSeq}`);
  }

  /** Only the continuity violations, so a case measures the gap and nothing else. */
  function gapViolationSubjects(candidate: Proof | null): string {
    if (proof == null || candidate == null) return '';
    return proof
      .validateProof(candidate)
      .filter((violation) => violation.code === 'ui-lag-gap')
      .map((violation) => `${violation.subject} ${violation.detail}`)
      .join(' | ');
  }

  it('refuses a window whose polls missed the records a rotation rolled away', () => {
    // The anomaly log keeps one previous generation. A capture that stops polling
    // long enough for TWO rolls loses everything the first roll had moved, and no
    // field of a single export shows it: the records that arrive are perfectly
    // self-consistent and the count INV-3.10 is judged on is simply smaller.
    const before = uiLagExport([lagAt(10, 1), lagAt(20, 2), lagAt(30, 3)]);
    const after = uiLagExport([lagAt(70, 7), lagAt(80, 8), lagAt(90, 9)], { generations: 2 });
    const built = buildFromPolls([before, after]);

    expect(gapRanges(built), why('records 4 to 6 rolled away between the two polls')).toEqual([
      '4..6',
    ]);
    // The violation has to NAME the range; a bare "something is missing" leaves a
    // reader unable to say how much of the window the capture cannot vouch for.
    expect(
      gapViolationSubjects(built),
      why('the refusal must name the range the capture never read'),
    ).toContain('4..6');
  });

  it('accepts polls that overlap across a rotation and counts every record once', () => {
    // The same rotation, polled the way the capture is meant to poll it: each
    // `?since=` reaches back before the previous answer ended, so the retained
    // generation still covers the seam. Nothing was lost, and the records the two
    // polls share are one record, not two.
    const before = uiLagExport([1, 2, 3, 4, 5].map((seq) => lagAt(seq * 10, seq)));
    const after = uiLagExport(
      [3, 4, 5, 6, 7, 8, 9].map((seq) => lagAt(seq * 10, seq)),
      { generations: 2 },
    );
    const built = buildFromPolls([before, after]);

    expect(gapRanges(built), why('overlapping polls across a rotation leave nothing unread')).toEqual([]);
    expect(built?.uiLagRecordsRead, why('nine distinct records were read, three of them twice')).toBe(9);
    expect(built?.uiLag.length, why('and each is one long task, not two')).toBe(9);
    expect(built?.uiLagExportShortfall, why('every poll handed over everything it matched')).toBe(0);
  });

  it('refuses records that arrived and rotated away after a poll found the log empty', () => {
    // The first poll proves the capture was running and the log held nothing.
    // An emptied log restarts at seq 1, so a later answer starting at 5 says
    // records 1 to 4 were written inside the window and were already gone. With
    // no earlier record read there is no covered sequence for the ordinary
    // overlap check to compare against, which is what made this loss invisible.
    const empty = uiLagExport([]);
    const after = uiLagExport([lagAt(50, 5), lagAt(60, 6)], { generations: 2 });
    const built = buildFromPolls([empty, after]);

    expect(gapRanges(built), why('an empty first poll is a floor, not an absence of evidence')).toEqual([
      '1..4',
    ]);
  });

  it('does not read a first poll that starts above one as a gap', () => {
    // Nothing preceded the first poll, so the records below its range may have
    // been discarded long before the window opened. Refusing here would refuse
    // every capture taken against a log that had ever been used.
    const first = uiLagExport([lagAt(50, 5), lagAt(60, 6)], { generations: 2 });
    const second = uiLagExport([lagAt(60, 6), lagAt(70, 7)], { generations: 2 });

    expect(gapRanges(buildFromPolls([first, second])), why('the first poll defines the floor')).toEqual([]);
  });

  it('refuses polls whose sequence range runs backwards', () => {
    // A later answer ending below what an earlier one already read means the
    // polls were handed over out of order. `clear()` (apps/daemon/src/
    // anomaly-log.ts) no longer restarts numbering at 1 — it persists a floor
    // and keeps counting up — so a sound daemon cannot produce this by being
    // cleared; only a genuinely out-of-order or corrupted poll sequence can.
    const before = uiLagExport([lagAt(50, 5), lagAt(60, 6)]);
    const afterReset = uiLagExport([lagAt(70, 1), lagAt(80, 2)]);

    expect(
      () => buildOrThrow([before, afterReset]),
      why('a sequence that goes backwards is not a sequence anyone can reconcile'),
    ).toThrow(/out of order/);
  });

  it('catches a gap that spans a clear, now that a cleared log never reuses a sequence', () => {
    // Before the fix, `clear()` reset numbering to 1, which could make records
    // written and lost in the new epoch invisible to this reconciliation (Sol
    // r1 HIGH finding, anomaly-log.ts:375). The fix removes the reset
    // entirely: a poll taken after a clear is just an ordinary continuation
    // from a persisted floor, not a new epoch, so the EXISTING overlap check
    // below catches a rotation loss that happens to span a clear exactly as it
    // would for any other rotation — no epoch-aware logic is needed here.
    const before = uiLagExport([1, 2, 3, 4, 5].map((seq) => lagAt(seq * 10, seq)));
    // The clear's floor was 5; the daemon continues at 6, and 6..10 roll away
    // before the next poll, which only retains 11..15.
    const after = uiLagExport(
      [11, 12, 13, 14, 15].map((seq) => lagAt(seq * 10, seq)),
      { generations: 2 },
    );

    expect(
      gapRanges(buildFromPolls([before, after])),
      why('records 6..10 rolled away in the continuation after the clear'),
    ).toEqual(['6..10']);
  });

  it('refuses a ui-lag export that carries no sequence range at all', () => {
    // An export with no range is an export nobody can reconcile: it cannot say
    // which records the log still retains, so the next poll cannot prove it
    // overlapped. Refused at the capture boundary rather than read as continuous,
    // for the reason every absent count in this schema is refused.
    const unnumbered = {
      anomalies: [lagAt(10, 1)],
      total: 1,
      path: '/dev/null',
    } as unknown as ListAnomaliesResponse;

    expect(
      () => buildOrThrow([unnumbered]),
      why('an export with no sequence range cannot be reconciled across a rotation'),
    ).toThrow(/sequence range/);
  });

  it('refuses a non-empty export whose null range hides legacy pre-sequence records', () => {
    // `seq` is optional (packages/contracts/src/api/anomalies.ts:81) precisely
    // because records written before the daemon started stamping it carry
    // none. `storedSequence` returns null for every one of them, so
    // `firstSeq`/`lastSeq` come back null even though the log is not empty —
    // indistinguishable, on the null range alone, from "the log holds
    // nothing" (Sol r1 MEDIUM finding, w3-performance-capture.ts:419). Built
    // with a double cast, not a single one: a genuinely legacy envelope
    // predates `highWaterSeq` too, so this object is not required to (and
    // structurally cannot, without lying) supply it.
    const legacyAt = new Date(Date.parse(WINDOW_START) + 5 * 60_000).toISOString();
    const legacyRecord = uiLagRecord(legacyAt, 1_500);
    const legacyExport = {
      anomalies: [legacyRecord],
      total: 1,
      path: '/dev/null',
      firstSeq: null,
      lastSeq: null,
      generations: 1,
    } as unknown as ListAnomaliesResponse;

    expect(
      () => buildOrThrow([legacyExport]),
      why('a non-empty null-range export cannot be waved through as an empty log'),
    ).toThrow(/legacy records/);
  });

  it('refuses the same legacy export called directly against the reconciler, not just through buildProof', () => {
    // Sol r2 MEDIUM finding: a restore-and-rerun of the pre-fix
    // `w3-performance-capture.ts` against this test file failed on a
    // `W3UiLagPoll` wrapper/shape mismatch (the pre-fix `buildProof` read
    // fields straight off `{ atUtc, response }`, which has none of them) —
    // not on the reconciler actually accepting the unsound input. Calling
    // `reconcileUiLagExports` directly, at its own unwrapped signature
    // (`ListAnomaliesResponse[]`, unchanged by the wrapper the poll-coverage
    // feature added around it), exercises the real defect either way: a
    // pre-fix reconciler run against this exact call silently returns the
    // legacy record as if the log were empty, while this branch's reconciler
    // throws.
    const legacyAt = new Date(Date.parse(WINDOW_START) + 5 * 60_000).toISOString();
    const legacyExport = {
      anomalies: [uiLagRecord(legacyAt, 1_500)],
      total: 1,
      path: '/dev/null',
      firstSeq: null,
      lastSeq: null,
      generations: 1,
    } as unknown as ListAnomaliesResponse;

    expect(
      () => capture?.reconcileUiLagExports([legacyExport]),
      why('the reconciler itself must refuse this, independent of how a poll reaches it'),
    ).toThrow(/legacy records/);
  });

  it('refuses a sequence range that is null on only one side', () => {
    // Sol r2 MEDIUM finding: the empty-range branch only checked
    // `firstSeq == null || lastSeq == null`, which also waves through a
    // half-null range that a sound daemon can never produce — `runCapture`
    // merely casts parsed JSON, so a malformed capture file reaches this
    // point unchecked.
    //
    // Sol r3 MEDIUM finding: a fixture with one non-empty record (`total: 1`)
    // never actually exercises that branch — the reviewed head's separate
    // non-empty/legacy guard rejects it first, for an unrelated reason, so a
    // test built that way would pass even against the pre-fix loose check.
    // `anomalies: []` / `total: 0` is what reaches the branch this pins: a
    // genuinely empty answer whose range is null on only one side, which the
    // pre-fix `firstSeq == null || lastSeq == null` check waved through as
    // "empty" and the current `classifySequenceRange` refuses outright.
    const halfNull = uiLagExport([], { lastSeq: 5 });

    expect(
      () => buildOrThrow([halfNull]),
      why('firstSeq null with lastSeq non-null is not a shape a sound daemon produces, even when the poll is otherwise empty'),
    ).toThrow(/malformed sequence range/);
  });

  it('refuses a sequence range that is null on the other side', () => {
    const halfNull = uiLagExport([], { firstSeq: 5 });

    expect(
      () => buildOrThrow([halfNull]),
      why('lastSeq null with firstSeq non-null is not a shape a sound daemon produces, even when the poll is otherwise empty'),
    ).toThrow(/malformed sequence range/);
  });

  it('refuses a censored clear that two empty polls would otherwise hide completely', () => {
    // Sol r2 HIGH finding: `firstSeq`/`lastSeq` come back null on BOTH sides
    // of a clear, so two polls that each find the log empty are, on the
    // ordinary range check alone, indistinguishable from a log nobody ever
    // used — even when a record was written and cleared in between. This is
    // that exact scenario: the opening poll finds a virgin log, one ui-lag
    // record gets written and cleared with nobody polling in between, and
    // the closing poll finds the log empty again.
    const opening = uiLagExport([]); // highWaterSeq 0 — nothing minted yet
    // The clear persisted a floor of 1: one sequence was issued, and nothing
    // is retained to show for it.
    const closing = uiLagExport([], { highWaterSeq: 1 });

    const built = buildFromPolls([opening, closing]);

    expect(
      gapRanges(built),
      why('highWaterSeq advancing between two empty polls means a record was minted and lost'),
    ).toEqual(['1..1']);
    expect(
      gapViolationSubjects(built),
      why('the refusal must name the range, the same as an ordinary rotation gap'),
    ).toContain('1..1');
  });

  // Sol r3 HIGH finding (e2e/lib/w3-performance-capture.ts:544): the prior fix
  // read `highWaterSeq` "defensively" — an absent or malformed value degraded
  // to "cannot check censorship for this poll" and the reconciliation carried
  // on as if nothing were wrong. That is fail-OPEN: a censored clear between
  // two empty polls is exactly the case with no other evidence, so a poll
  // that cannot supply a trustworthy `highWaterSeq` must refuse outright, not
  // be read as benign. Legacy exports predating `highWaterSeq` are explicitly
  // ineligible for INV-3.10 for the same reason.
  describe('fails closed on an untrustworthy highWaterSeq', () => {
    it('refuses a closing empty poll whose highWaterSeq is absent', () => {
      const opening = uiLagExport([]);
      const closing = uiLagExport([]) as Partial<ListAnomaliesResponse>;
      delete closing.highWaterSeq;

      expect(
        () => buildOrThrow([opening, closing as ListAnomaliesResponse]),
        why('a poll with no highWaterSeq cannot prove a censored clear did not happen between it and the next poll'),
      ).toThrow(/no highWaterSeq/);
    });

    it('refuses a closing empty poll whose highWaterSeq is null', () => {
      const opening = uiLagExport([]);
      const closing = uiLagExport([], { highWaterSeq: null as unknown as number });

      expect(
        () => buildOrThrow([opening, closing]),
        why('a null highWaterSeq is an absence dressed up as a value, not evidence'),
      ).toThrow(/null highWaterSeq/);
    });

    it('refuses a closing empty poll whose highWaterSeq is fractional', () => {
      const opening = uiLagExport([]);
      const closing = uiLagExport([], { highWaterSeq: 1.5 });

      expect(
        () => buildOrThrow([opening, closing]),
        why('a fractional mark cannot identify a whole sequence number'),
      ).toThrow(/fractional/);
    });

    it('refuses a closing empty poll whose highWaterSeq is negative', () => {
      const opening = uiLagExport([]);
      const closing = uiLagExport([], { highWaterSeq: -1 });

      expect(
        () => buildOrThrow([opening, closing]),
        why('a sequence high-water mark cannot fall below zero'),
      ).toThrow(/negative highWaterSeq/);
    });

    it('refuses a closing empty poll whose highWaterSeq is stale, below a prior poll', () => {
      const opening = uiLagExport([], { highWaterSeq: 5 });
      const closing = uiLagExport([], { highWaterSeq: 3 });

      expect(
        () => buildOrThrow([opening, closing]),
        why('highWaterSeq must never move backwards between polls, the same as an ordinary sequence range'),
      ).toThrow(/highWaterSeq 3, below the 5/);
    });

    it('enforces highWaterSeq >= lastSeq against a poll\'s own retained range', () => {
      // Not a two-empty-poll case: a single poll that DOES retain records, but
      // whose highWaterSeq trails what it says it retains. That is a poll
      // contradicting itself — the mark can never be behind the range it is
      // reporting alongside it.
      const poll = uiLagExport([lagAt(10, 1), lagAt(20, 2)], { highWaterSeq: 1 });

      expect(
        () => buildOrThrow([poll]),
        why('highWaterSeq below the poll\'s own lastSeq is a self-contradictory envelope'),
      ).toThrow(/below its own retained lastSeq/);
    });
  });
});

describe('W3 endpoint-latency proof — ui-lag poll coverage', () => {
  /** A `ui-lag` record inside the pinned window, numbered as the daemon numbers it. */
  function lagAt(minutes: number, seq: number, durationMs = 1_200): AnomalyRecord {
    const at = new Date(Date.parse(WINDOW_START) + minutes * 60_000).toISOString();
    return uiLagRecord(at, durationMs, seq);
  }

  function pollAt(atUtc: string, response: ListAnomaliesResponse): CaptureModule.W3UiLagPoll {
    return { atUtc, response };
  }

  function buildWithPolls(polls: readonly CaptureModule.W3UiLagPoll[]): Proof | undefined {
    return capture?.buildProof({
      timingLog: golden,
      anomalies: polls,
      startUtc: WINDOW_START,
      sourceRun: 'golden',
      capture: { ...CAPTURE_METADATA },
    });
  }

  it('refuses a single late poll even when its retained range looks continuous', () => {
    // The exact censoring shape the finding names (Sol r1 HIGH finding,
    // w3-performance-capture.ts:297,401): one export taken near the window's
    // close, whose range has nothing before it to disagree with — on sequence
    // numbers alone this is indistinguishable from a log nobody had ever used.
    // Records 1..99 may already have rotated away before this poll ever ran.
    const lateHour = new Date(Date.parse(WINDOW_START) + 23 * 3_600_000).toISOString();
    const late = uiLagExport([lagAt(23 * 60, 200)], { firstSeq: 100, lastSeq: 200, generations: 2 });

    expect(
      () => buildWithPolls([pollAt(lateHour, late)]),
      why('a single poll cannot prove the window was watched from open to close'),
    ).toThrow(/only one ui-lag poll/);
  });

  it('refuses zero ui-lag polls', () => {
    expect(
      () => buildWithPolls([]),
      why('a capture with no observation cannot be judged for INV-3.10'),
    ).toThrow(/no ui-lag polls/);
  });

  it('refuses polls that never reach the window close', () => {
    const secondHour = new Date(Date.parse(WINDOW_START) + 2 * 3_600_000).toISOString();
    const first = pollAt(WINDOW_START, uiLagExport([]));
    const second = pollAt(secondHour, uiLagExport([]));

    expect(
      () => buildWithPolls([first, second]),
      why('polls that stop hours before the window closes leave the tail unwatched'),
    ).toThrow(/before the window closed/);
  });

  it('refuses polls that never reach the window open', () => {
    const lateStart = new Date(Date.parse(WINDOW_START) + 2 * 3_600_000).toISOString();
    const first = pollAt(lateStart, uiLagExport([]));
    const second = pollAt(WINDOW_END, uiLagExport([]));

    expect(
      () => buildWithPolls([first, second]),
      why('polls that start hours after the window opens leave the head unwatched'),
    ).toThrow(/after the window opened/);
  });

  it('accepts polls that bracket the window even when only two were taken', () => {
    const first = pollAt(WINDOW_START, uiLagExport([]));
    const second = pollAt(WINDOW_END, uiLagExport([]));

    expect(
      () => buildWithPolls([first, second]),
      why('two polls bracketing the window is the minimum sound case'),
    ).not.toThrow();
  });

  describe('checkPollCoverage, called directly', () => {
    // Sol r2 MEDIUM finding: `checkPollCoverage` reads only `atUtc` off each
    // poll and has no equivalent in the pre-fix capture module (poll
    // observation times, and the whole `W3UiLagPoll` concept, are new to this
    // track) — restoring the pre-fix file and re-running a test that goes
    // through `buildProof`'s wrapper only ever proves a shape mismatch, not
    // this function's own behavior. Calling the exported validator directly,
    // with no `response`/envelope on the polls at all, tests exactly this
    // function and nothing a wrapper could get in the way of.
    const window = { startUtc: WINDOW_START, endUtc: WINDOW_END };

    it('refuses zero polls', () => {
      expect(
        () => capture?.checkPollCoverage([], window),
        why('a window with no recorded observation cannot be judged'),
      ).toThrow(/no ui-lag polls/);
    });

    it('refuses a single poll, however well placed', () => {
      expect(
        () => capture?.checkPollCoverage([{ atUtc: WINDOW_START, response: uiLagExport([]) }], window),
        why('one poll cannot prove the window was watched continuously'),
      ).toThrow(/only one ui-lag poll/);
    });

    it('refuses polls that never reach the window close', () => {
      const secondHour = new Date(Date.parse(WINDOW_START) + 2 * 3_600_000).toISOString();
      expect(
        () => capture?.checkPollCoverage(
          [
            { atUtc: WINDOW_START, response: uiLagExport([]) },
            { atUtc: secondHour, response: uiLagExport([]) },
          ],
          window,
        ),
        why('polls that stop hours before the window closes leave the tail unwatched'),
      ).toThrow(/before the window closed/);
    });

    it('refuses polls that never reach the window open', () => {
      const lateStart = new Date(Date.parse(WINDOW_START) + 2 * 3_600_000).toISOString();
      expect(
        () => capture?.checkPollCoverage(
          [
            { atUtc: lateStart, response: uiLagExport([]) },
            { atUtc: WINDOW_END, response: uiLagExport([]) },
          ],
          window,
        ),
        why('polls that start hours after the window opens leave the head unwatched'),
      ).toThrow(/after the window opened/);
    });

    it('accepts polls that bracket the window', () => {
      expect(
        () => capture?.checkPollCoverage(
          [
            { atUtc: WINDOW_START, response: uiLagExport([]) },
            { atUtc: WINDOW_END, response: uiLagExport([]) },
          ],
          window,
        ),
        why('two polls bracketing the window is the minimum sound case'),
      ).not.toThrow();
    });
  });
});
