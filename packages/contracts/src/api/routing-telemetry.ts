// Routing telemetry contract (WR wave, P0 skeleton -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.2 L5). Per-run telemetry
// row shape (stage, template, design system, routed-vs-observed model,
// tokens, cache hits, latency, cost, gate outcomes, escalation) and the
// per-lane meter shape both endpoints/CLI subcommands in this wave return.
// Durable persistence (SQLite) and real gate-outcome content land in later
// WR tranches -- see docs/plans/waves/WR-routing.md's Tranche register
// (CWR-P1-2 for the telemetry row, CWR-P2-4 for lane meters).

export type RoutingGateOutcome = 'pass' | 'fail' | 'blocked-on-founder';

export interface RoutingTelemetryTokenCounts {
  input: number;
  output: number;
  cacheReadInput: number;
}

/** One row per run: what was *routed* versus what actually *ran* -- the
 * dataset plan §3.2 L5 says is "the only path to ever justifying learned
 * routing." */
export interface RoutingTelemetryRow {
  runId: string;
  stage: string;
  templateId: string | null;
  designSystem: string | null;
  routedModel: string;
  /** Null until the run reports back (usage arrives post-run, plan §3.1). */
  observedModel: string | null;
  tokens: RoutingTelemetryTokenCounts;
  cacheHits: number;
  latencyMs: number;
  costUsd: number;
  /** True when `costUsd` is a pre-run estimate rather than a billed figure
   * (mirrors the usage meter's `pricingVersion` uncertainty pattern). */
  costEstimated: boolean;
  gateOutcomes: Record<string, RoutingGateOutcome>;
  escalated: boolean;
  createdAt: string;
  recordedAt: string;
}

/** Per-lane rollup -- plan §5/fix-round-1 HIGH-6's "lane meter closure",
 * exposed through `/api/routing/meters` and `od route meters --json`. */
export interface LaneMeter {
  lane: string;
  runsRouted: number;
  runsObserved: number;
  escalationRate: number;
  passRate: number;
}

export function isRoutingTelemetryRow(value: unknown): value is RoutingTelemetryRow {
  if (value === null || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const tokens = row.tokens as Record<string, unknown> | undefined;
  return (
    typeof row.runId === 'string' &&
    typeof row.stage === 'string' &&
    (row.templateId === null || typeof row.templateId === 'string') &&
    (row.designSystem === null || typeof row.designSystem === 'string') &&
    typeof row.routedModel === 'string' &&
    (row.observedModel === null || typeof row.observedModel === 'string') &&
    typeof tokens === 'object' &&
    tokens !== null &&
    typeof tokens.input === 'number' &&
    typeof tokens.output === 'number' &&
    typeof tokens.cacheReadInput === 'number' &&
    typeof row.cacheHits === 'number' &&
    typeof row.latencyMs === 'number' &&
    typeof row.costUsd === 'number' &&
    typeof row.costEstimated === 'boolean' &&
    typeof row.gateOutcomes === 'object' &&
    row.gateOutcomes !== null &&
    typeof row.escalated === 'boolean' &&
    typeof row.createdAt === 'string' &&
    typeof row.recordedAt === 'string'
  );
}

export function isLaneMeter(value: unknown): value is LaneMeter {
  if (value === null || typeof value !== 'object') return false;
  const meter = value as Record<string, unknown>;
  return (
    typeof meter.lane === 'string' &&
    typeof meter.runsRouted === 'number' &&
    typeof meter.runsObserved === 'number' &&
    typeof meter.escalationRate === 'number' &&
    typeof meter.passRate === 'number'
  );
}

/** Placeholder lane meter for a lane with no routed runs yet -- used by the
 * P0 daemon stub so `/api/routing/meters` returns a well-shaped empty array
 * rather than `null`/`undefined`. */
export function emptyLaneMeter(lane: string): LaneMeter {
  return { lane, runsRouted: 0, runsObserved: 0, escalationRate: 0, passRate: 0 };
}
