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
  return {
    window: { startUtc: WINDOW_START, endUtc: WINDOW_END, gaps: [] },
    capture: captureMetadata(),
    routeAttempts: requiredRoutes().map((required) => ({
      ...required,
      source: 'daemon' as const,
      attempts: 30,
    })),
    samples,
    uiLag: [],
    uiLagUnmeasurable: 0,
    ...overrides,
  } as Proof;
}

function uiLagRecord(at: string, durationMs: number): AnomalyRecord {
  return {
    id: `ui-lag-${at}`,
    at,
    kind: 'ui-lag',
    severity: 'warn',
    source: 'web',
    summary: `Main thread blocked for ${durationMs}ms`,
    detail: { safetyEvent: 'client_long_task', duration_ms: durationMs },
  };
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
    const response: ListAnomaliesResponse = {
      anomalies: records,
      total: records.length,
      path: '/dev/null',
    };
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

  it('builds a proof whose window is exactly 24 h from the recorded rows', () => {
    const built = capture?.buildProof({
      timingLog: golden,
      anomalies: { anomalies: [], total: 0, path: '/dev/null' },
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
