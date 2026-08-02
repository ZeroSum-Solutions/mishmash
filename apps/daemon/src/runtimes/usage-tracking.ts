// NM-20 cost & usage meter (C1-7 / C1-8 / C1-9).
//
// The hard part already exists and is deliberately NOT modified here:
// `run-analytics-observability.ts`'s `scanRunEventsForUsageAnalytics`
// normalizes input/output/cache tokens across the additive (Anthropic) vs
// inclusive (OpenAI/codex) provider conventions into one
// `input_tokens_effective` figure. This module is the NEW layer on top:
// price that effective figure against a small, honest model-pricing table
// (never inventing a number for a model this daemon cannot actually price
// -- C1-9), and persist the result durably in a table this module owns
// outright, so a project's total is a real sum of its runs that survives a
// daemon restart.
//
// Deliberately a dedicated `run_usage` SQLite table, not a new column on
// the shared `messages` table or a new `PersistedAgentEvent` kind: neither
// `db.ts`'s schema nor the web-side exhaustive `switch (event.kind)`
// consumers (e.g. ChatPane.tsx's `hasVisibleBrandAssistantEvent`) are in
// this wave's write lease, and extending either would either need a
// migration in an unleased file or silently break an unleased file's
// typecheck.

import type Database from 'better-sqlite3';
import {
  buildModelRouting,
  type ModelRoutingDisplayState,
} from '@open-design/contracts';
import { scanRunEventsForUsageAnalytics } from '../run-analytics-observability.js';
import { getRememberedLiveModels } from './models.js';
import type { RuntimeModelOption } from './types.js';

export type PricingVersion = 'estimated' | 'unavailable' | 'partial';

export interface RunUsageRecord {
  requested: string;
  resolved: string;
  reported: string | null;
  displayState: ModelRoutingDisplayState;
  model: string | null;
  inputTokensEffective: number | null;
  outputTokens: number | null;
  cacheReadInputTokens: number | null;
  costUsd: number | null;
  pricingVersion: PricingVersion;
}

export interface StoredRunUsageRecord extends RunUsageRecord {
  runId: string;
  projectId: string;
  conversationId: string | null;
  agentId: string | null;
  recordedAt: number;
}

export interface ProjectUsageSummary {
  projectId: string;
  currency: 'USD';
  totalCostUsd: number | null;
  pricingVersion: PricingVersion;
  runCount: number;
  pricedRunCount: number;
}

// Public list pricing (USD per million tokens), as an honest ESTIMATE --
// not a guarantee of the exact billed amount (real invoices may differ by
// discount tier, promotional credits, or a provider price change this
// table hasn't caught up with yet). Deliberately small: a model absent
// here renders pricingVersion:'unavailable', never a confident fake
// number. Extend as new well-known models ship.
export const KNOWN_MODEL_PRICING_USD_PER_MILLION: Readonly<
  Record<string, { input: number; output: number }>
> = {
  // Claude rows verified 2026-08-02 against
  // platform.claude.com/docs/en/about-claude/pricing. Two corrections from
  // that pass: opus-4-5 carried Opus 4.1's $15/$75 and haiku-4-5 carried
  // Haiku 3.5's $0.80/$4. Sonnet 5 uses the standard $3/$15 rate — an intro
  // $2/$10 runs through 2026-08-31 only, so this slightly overestimates
  // until then rather than silently undercounting after.
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-opus-4-5': { input: 5, output: 25 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  // GPT-5.6 tiers under the slugs `codex debug models` actually reports
  // (gpt-5.6-sol/-terra/-luna), at the published post-2026-07-30 rates.
  'gpt-5.6-sol': { input: 5, output: 30 },
  'gpt-5.6-terra': { input: 2, output: 12 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2 },
  'gpt-5': { input: 2.5, output: 10 },
  'gpt-5-codex': { input: 2.5, output: 10 },
  'gpt-5.1': { input: 2.5, output: 10 },
  'gpt-5.1-codex-mini': { input: 0.5, output: 2 },
  'gpt-5.3-codex': { input: 2.5, output: 10 },
  'gpt-5.4': { input: 2.5, output: 10 },
  'gpt-5.4-mini': { input: 0.5, output: 2 },
  'gpt-5.5': { input: 2.5, output: 10 },
  'moonshotai/kimi-k3': { input: 0.6, output: 2.5 },
  'deepseek-v4-pro': { input: 0.6, output: 2 },
  'deepseek-v4-flash': { input: 0.2, output: 0.6 },
};

/**
 * Resolves a per-million-token price for `model`. Prefers a live-fetched
 * catalog price (`liveModels`, e.g. AMR's own real per-model USD rate --
 * the actual account's catalog, not a guess) over the static table, since
 * a live figure reflects reality more closely than any hardcoded estimate
 * could. Falls back to the static table, then to `null` (unpriceable).
 */
export function priceForModel(
  agentId: string | null,
  model: string | null,
  liveModels?: readonly RuntimeModelOption[],
): { input: number; output: number } | null {
  if (!model) return null;
  const live = (liveModels ?? (agentId ? getRememberedLiveModels(agentId) : [])).find(
    (m) => m.id === model,
  );
  if (
    live?.inputPriceUsdPerMillion !== undefined &&
    live?.outputPriceUsdPerMillion !== undefined
  ) {
    return { input: live.inputPriceUsdPerMillion, output: live.outputPriceUsdPerMillion };
  }
  const known = KNOWN_MODEL_PRICING_USD_PER_MILLION[model];
  if (known) return { ...known };
  // Claude CLIs report context-window variants as `<model>[1m]`-style ids.
  // "Claude 4.6 and later models include the full 1M token context window at
  // standard pricing" (pricing docs, read 2026-08-02), so the bracket suffix
  // is a window flag on the same SKU — price it as the base model.
  const baseModel = model.replace(/\[[^\]]*\]$/, '');
  if (baseModel !== model) {
    const base = KNOWN_MODEL_PRICING_USD_PER_MILLION[baseModel];
    if (base) return { ...base };
  }
  return null;
}

interface RunEventLike {
  id?: number;
  event: string;
  data: unknown;
  timestamp?: number;
}

/**
 * Computes the full usage + cost record for one run from its raw (SSE-wire
 * shaped) events -- the same shape `run.events` carries live, which is why
 * this must run at run-finalize time (while that shape is still available)
 * rather than being re-derived later from the persisted, differently-shaped
 * `PersistedAgentEvent[]` history.
 */
export function computeRunUsageRecord(params: {
  requestedRaw: string | null | undefined;
  resolvedRaw: string | null | undefined;
  reportedRaw: string | null | undefined;
  agentId: string | null;
  events: RunEventLike[];
  liveModels?: readonly RuntimeModelOption[];
}): RunUsageRecord {
  const routing = buildModelRouting({
    requestedRaw: params.requestedRaw,
    resolvedRaw: params.resolvedRaw,
    reportedRaw: params.reportedRaw,
  });
  const usage = scanRunEventsForUsageAnalytics(params.events, params.requestedRaw ?? null, 0);
  const model = routing.resolved !== 'default' ? routing.resolved : usage.agent_reported_model;
  const price = priceForModel(params.agentId, model, params.liveModels);
  const inputTokensEffective = usage.input_tokens_effective ?? null;
  const outputTokens = usage.output_tokens ?? null;
  const costUsd =
    price && inputTokensEffective !== null && outputTokens !== null
      ? (inputTokensEffective / 1_000_000) * price.input +
        (outputTokens / 1_000_000) * price.output
      : null;
  return {
    requested: routing.requested,
    resolved: routing.resolved,
    reported: routing.reported,
    displayState: routing.displayState,
    model,
    inputTokensEffective,
    outputTokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? null,
    costUsd,
    pricingVersion: costUsd !== null ? 'estimated' : 'unavailable',
  };
}

export function ensureUsageTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS run_usage (
      run_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      conversation_id TEXT,
      agent_id TEXT,
      model TEXT,
      requested_model TEXT,
      resolved_model TEXT,
      reported_model TEXT,
      display_state TEXT,
      input_tokens_effective INTEGER,
      output_tokens INTEGER,
      cache_read_input_tokens INTEGER,
      cost_usd REAL,
      pricing_version TEXT,
      recorded_at INTEGER NOT NULL
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_run_usage_project_id ON run_usage(project_id)`,
  );
}

/** Idempotent per run id -- a retried/resumed run recomputed at a later
 *  finalize replaces its own prior row rather than accumulating duplicates,
 *  so a project's total is always the sum of CURRENT run records. */
export function recordRunUsage(
  db: Database.Database,
  params: {
    runId: string;
    projectId: string;
    conversationId: string | null;
    agentId: string | null;
    record: RunUsageRecord;
  },
): void {
  const r = params.record;
  db.prepare(
    `INSERT INTO run_usage
       (run_id, project_id, conversation_id, agent_id, model, requested_model,
        resolved_model, reported_model, display_state, input_tokens_effective,
        output_tokens, cache_read_input_tokens, cost_usd, pricing_version, recorded_at)
     VALUES (@runId, @projectId, @conversationId, @agentId, @model, @requestedModel,
             @resolvedModel, @reportedModel, @displayState, @inputTokensEffective,
             @outputTokens, @cacheReadInputTokens, @costUsd, @pricingVersion, @recordedAt)
     ON CONFLICT(run_id) DO UPDATE SET
       project_id = excluded.project_id,
       conversation_id = excluded.conversation_id,
       agent_id = excluded.agent_id,
       model = excluded.model,
       requested_model = excluded.requested_model,
       resolved_model = excluded.resolved_model,
       reported_model = excluded.reported_model,
       display_state = excluded.display_state,
       input_tokens_effective = excluded.input_tokens_effective,
       output_tokens = excluded.output_tokens,
       cache_read_input_tokens = excluded.cache_read_input_tokens,
       cost_usd = excluded.cost_usd,
       pricing_version = excluded.pricing_version,
       recorded_at = excluded.recorded_at`,
  ).run({
    runId: params.runId,
    projectId: params.projectId,
    conversationId: params.conversationId,
    agentId: params.agentId,
    model: r.model,
    requestedModel: r.requested,
    resolvedModel: r.resolved,
    reportedModel: r.reported,
    displayState: r.displayState,
    inputTokensEffective: r.inputTokensEffective,
    outputTokens: r.outputTokens,
    cacheReadInputTokens: r.cacheReadInputTokens,
    costUsd: r.costUsd,
    pricingVersion: r.pricingVersion,
    recordedAt: Date.now(),
  });
}

interface RunUsageRow {
  run_id: string;
  project_id: string;
  conversation_id: string | null;
  agent_id: string | null;
  model: string | null;
  requested_model: string | null;
  resolved_model: string | null;
  reported_model: string | null;
  display_state: string | null;
  input_tokens_effective: number | null;
  output_tokens: number | null;
  cache_read_input_tokens: number | null;
  cost_usd: number | null;
  pricing_version: string | null;
  recorded_at: number;
}

function rowToStoredRecord(row: RunUsageRow): StoredRunUsageRecord {
  return {
    runId: row.run_id,
    projectId: row.project_id,
    conversationId: row.conversation_id,
    agentId: row.agent_id,
    requested: row.requested_model ?? 'default',
    resolved: row.resolved_model ?? 'default',
    reported: row.reported_model,
    displayState: (row.display_state as ModelRoutingDisplayState) ?? 'unverified',
    model: row.model,
    inputTokensEffective: row.input_tokens_effective,
    outputTokens: row.output_tokens,
    cacheReadInputTokens: row.cache_read_input_tokens,
    costUsd: row.cost_usd,
    pricingVersion: (row.pricing_version as PricingVersion) ?? 'unavailable',
    recordedAt: row.recorded_at,
  };
}

export function listProjectRunUsage(
  db: Database.Database,
  projectId: string,
): StoredRunUsageRecord[] {
  const rows = db
    .prepare(
      `SELECT run_id, project_id, conversation_id, agent_id, model, requested_model,
              resolved_model, reported_model, display_state, input_tokens_effective,
              output_tokens, cache_read_input_tokens, cost_usd, pricing_version, recorded_at
         FROM run_usage
        WHERE project_id = ?
        ORDER BY recorded_at ASC`,
    )
    .all(projectId) as RunUsageRow[];
  return rows.map(rowToStoredRecord);
}

export function getRunUsage(
  db: Database.Database,
  runId: string,
): StoredRunUsageRecord | null {
  const row = db
    .prepare(
      `SELECT run_id, project_id, conversation_id, agent_id, model, requested_model,
              resolved_model, reported_model, display_state, input_tokens_effective,
              output_tokens, cache_read_input_tokens, cost_usd, pricing_version, recorded_at
         FROM run_usage
        WHERE run_id = ?`,
    )
    .get(runId) as RunUsageRow | undefined;
  return row ? rowToStoredRecord(row) : null;
}

/**
 * Project total = the exact sum of its own priced runs (C1-7) -- never
 * re-derived from anywhere else. `pricingVersion` is honest about partial
 * knowledge (C1-9): 'estimated' only when every run in the project priced,
 * 'partial' when some did and some didn't (the total is real but
 * incomplete), 'unavailable' when none did (never a confident $0.00).
 */
export function projectUsageSummary(
  db: Database.Database,
  projectId: string,
): ProjectUsageSummary {
  const runs = listProjectRunUsage(db, projectId);
  const priced = runs.filter((r) => r.costUsd !== null);
  const pricingVersion: PricingVersion =
    runs.length === 0 || priced.length === 0
      ? 'unavailable'
      : priced.length === runs.length
        ? 'estimated'
        : 'partial';
  return {
    projectId,
    currency: 'USD',
    // C1-7: always the real sum of whatever IS priced -- 0 when nothing is
    // (no runs at all, or runs that exist but priced.length is 0 either
    // way), never a null placeholder standing in for "no data." A null
    // total is indistinguishable, to a real HTTP "before any run" baseline
    // read, from "this project has unpriced runs" -- collapsing a genuine
    // $0 observation into the same signal as "unknown." `pricingVersion`
    // is the one, sole "is this confident/complete" signal now (C1-9);
    // every consumer that used to gate on `totalCostUsd === null` to avoid
    // rendering a bare fake $0.00 must gate on `pricingVersion ===
    // 'unavailable'` instead (see EntryShell.tsx's formatUsageTotal and
    // cli.ts's runUsage).
    totalCostUsd: priced.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
    pricingVersion,
    runCount: runs.length,
    pricedRunCount: priced.length,
  };
}
