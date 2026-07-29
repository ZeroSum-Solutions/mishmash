/**
 * NM-20 cost meter (C1-7/C1-8/C1-9). The daemon already normalizes usage
 * across provider conventions (run-analytics-observability.ts) and computes
 * a provider-reported cost where the wire carries one (langfuse-trace.ts) --
 * neither file is leased or modified here. This module is the NEW in-app
 * aggregation layer: a small, honest pricing table for models this daemon
 * can actually price, a per-run cost computation built on the SAME
 * cache-aware effective-input-token figure run-analytics-observability.ts
 * already derives (so additive vs inclusive cache conventions can never be
 * double-counted here either), and durable persistence in its own SQLite
 * table (a dedicated table owned by this module, not a new column on the
 * shared `messages` table, so nothing outside the W1 lease has to change).
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeRunUsageRecord,
  ensureUsageTable,
  KNOWN_MODEL_PRICING_USD_PER_MILLION,
  listProjectRunUsage,
  priceForModel,
  projectUsageSummary,
  recordRunUsage,
} from '../../src/runtimes/usage-tracking.js';

function agentUsageEvent(usage: Record<string, number>) {
  return { event: 'agent', data: { type: 'usage', usage }, timestamp: Date.now() };
}
function agentStatusInitEvent(model: string) {
  return { event: 'agent', data: { type: 'status', label: 'initializing', model }, timestamp: Date.now() };
}

describe('priceForModel', () => {
  it('returns the known table entry for a priced model', () => {
    expect(priceForModel(null, 'claude-sonnet-4-5')).toEqual(
      KNOWN_MODEL_PRICING_USD_PER_MILLION['claude-sonnet-4-5'],
    );
  });

  it('returns null for a model this daemon has no honest price for', () => {
    expect(priceForModel(null, 'Gemini 3.1 Pro (High)')).toBeNull();
    expect(priceForModel(null, null)).toBeNull();
  });

  it('prefers a live-fetched per-model price over the static table when both could apply', () => {
    const live = [{ id: 'claude-sonnet-4-5', label: 'x', inputPriceUsdPerMillion: 111, outputPriceUsdPerMillion: 222 }];
    expect(priceForModel('amr', 'claude-sonnet-4-5', live)).toEqual({ input: 111, output: 222 });
  });
});

describe('computeRunUsageRecord', () => {
  it('prices a known model using effective (cache-aware) input tokens, not raw input alone', () => {
    // Additive convention (Anthropic): effective = input + cache_read + cache_creation.
    const events = [
      agentStatusInitEvent('claude-sonnet-4-5'),
      agentUsageEvent({
        input_tokens: 4000,
        output_tokens: 800,
        cache_creation_input_tokens: 300,
        cache_read_input_tokens: 900,
      }),
    ];
    const record = computeRunUsageRecord({
      requestedRaw: 'claude-sonnet-4-5',
      resolvedRaw: 'claude-sonnet-4-5',
      reportedRaw: 'claude-sonnet-4-5',
      agentId: 'claude',
      events,
    });
    expect(record.inputTokensEffective).toBe(4000 + 900 + 300);
    expect(record.pricingVersion).toBe('estimated');
    const price = KNOWN_MODEL_PRICING_USD_PER_MILLION['claude-sonnet-4-5']!;
    const expectedCost =
      ((4000 + 900 + 300) / 1_000_000) * price.input + (800 / 1_000_000) * price.output;
    expect(record.costUsd).toBeCloseTo(expectedCost, 10);
  });

  it('produces a strictly larger cost for a strictly larger usage shape on the same model', () => {
    const small = computeRunUsageRecord({
      requestedRaw: 'claude-sonnet-4-5',
      resolvedRaw: 'claude-sonnet-4-5',
      reportedRaw: 'claude-sonnet-4-5',
      agentId: 'claude',
      events: [
        agentStatusInitEvent('claude-sonnet-4-5'),
        agentUsageEvent({ input_tokens: 200, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
      ],
    });
    const large = computeRunUsageRecord({
      requestedRaw: 'claude-sonnet-4-5',
      resolvedRaw: 'claude-sonnet-4-5',
      reportedRaw: 'claude-sonnet-4-5',
      agentId: 'claude',
      events: [
        agentStatusInitEvent('claude-sonnet-4-5'),
        agentUsageEvent({ input_tokens: 4000, output_tokens: 800, cache_creation_input_tokens: 300, cache_read_input_tokens: 900 }),
      ],
    });
    expect(small.costUsd).not.toBeNull();
    expect(large.costUsd).not.toBeNull();
    expect(large.costUsd as number).toBeGreaterThan(small.costUsd as number);
  });

  it('is unavailable (never a fake number) for a model with no known price', () => {
    const record = computeRunUsageRecord({
      requestedRaw: 'Gemini 3.1 Pro (High)',
      resolvedRaw: 'Gemini 3.1 Pro (High)',
      reportedRaw: null,
      agentId: 'antigravity',
      events: [],
    });
    expect(record.costUsd).toBeNull();
    expect(record.pricingVersion).toBe('unavailable');
  });

  it('treats codex-style inclusive cache accounting correctly (no double count)', () => {
    // Codex's own convention: input_tokens already includes the cached
    // subset, so effective input === raw input_tokens (900+... would be
    // double counting the inclusive number).
    const record = computeRunUsageRecord({
      requestedRaw: 'gpt-5-codex',
      resolvedRaw: 'gpt-5-codex',
      reportedRaw: null,
      agentId: 'codex',
      events: [
        {
          event: 'agent',
          data: { type: 'usage', usage: { input_tokens: 1000, output_tokens: 50, cached_input_tokens: 400 } },
          timestamp: Date.now(),
        },
      ],
    });
    expect(record.inputTokensEffective).toBe(1000);
  });
});

describe('run_usage table persistence', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    ensureUsageTable(db);
  });

  afterEach(() => {
    db.close();
  });

  it('round-trips a recorded run through listProjectRunUsage', () => {
    recordRunUsage(db, {
      runId: 'run-1',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      agentId: 'claude',
      record: computeRunUsageRecord({
        requestedRaw: 'claude-sonnet-4-5',
        resolvedRaw: 'claude-sonnet-4-5',
        reportedRaw: 'claude-sonnet-4-5',
        agentId: 'claude',
        events: [
          agentStatusInitEvent('claude-sonnet-4-5'),
          agentUsageEvent({ input_tokens: 200, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }),
        ],
      }),
    });
    const rows = listProjectRunUsage(db, 'proj-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.runId).toBe('run-1');
    expect(rows[0]?.costUsd).not.toBeNull();
    expect(rows[0]?.model).toBe('claude-sonnet-4-5');
  });

  it('upserts on re-recording the same run id rather than duplicating', () => {
    const base = {
      runId: 'run-2',
      projectId: 'proj-1',
      conversationId: 'conv-1',
      agentId: 'claude' as const,
    };
    recordRunUsage(db, {
      ...base,
      record: computeRunUsageRecord({
        requestedRaw: 'claude-sonnet-4-5', resolvedRaw: 'claude-sonnet-4-5', reportedRaw: 'claude-sonnet-4-5',
        agentId: 'claude',
        events: [agentUsageEvent({ input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 })],
      }),
    });
    recordRunUsage(db, {
      ...base,
      record: computeRunUsageRecord({
        requestedRaw: 'claude-sonnet-4-5', resolvedRaw: 'claude-sonnet-4-5', reportedRaw: 'claude-sonnet-4-5',
        agentId: 'claude',
        events: [agentUsageEvent({ input_tokens: 9000, output_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 })],
      }),
    });
    const rows = listProjectRunUsage(db, 'proj-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.inputTokensEffective).toBe(9000);
  });

  it('sums exactly across multiple priced runs in a project (aggregation cannot drift from the sum of its runs)', () => {
    const usages = [
      { input_tokens: 200, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      { input_tokens: 4000, output_tokens: 800, cache_creation_input_tokens: 300, cache_read_input_tokens: 900 },
    ];
    let expectedTotal = 0;
    usages.forEach((usage, i) => {
      const record = computeRunUsageRecord({
        requestedRaw: 'claude-sonnet-4-5', resolvedRaw: 'claude-sonnet-4-5', reportedRaw: 'claude-sonnet-4-5',
        agentId: 'claude',
        events: [agentUsageEvent(usage)],
      });
      expectedTotal += record.costUsd ?? 0;
      recordRunUsage(db, { runId: `run-sum-${i}`, projectId: 'proj-sum', conversationId: 'conv-1', agentId: 'claude', record });
    });
    const summary = projectUsageSummary(db, 'proj-sum');
    expect(summary.totalCostUsd).toBeCloseTo(expectedTotal, 10);
    expect(summary.pricingVersion).toBe('estimated');
    expect(summary.runCount).toBe(2);
    expect(summary.pricedRunCount).toBe(2);
  });

  it('reports a partial total (not a confident number) when a project mixes priced and unpriced runs', () => {
    recordRunUsage(db, {
      runId: 'priced-run',
      projectId: 'proj-mixed',
      conversationId: 'conv-1',
      agentId: 'claude',
      record: computeRunUsageRecord({
        requestedRaw: 'claude-sonnet-4-5', resolvedRaw: 'claude-sonnet-4-5', reportedRaw: 'claude-sonnet-4-5',
        agentId: 'claude',
        events: [agentUsageEvent({ input_tokens: 200, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 })],
      }),
    });
    recordRunUsage(db, {
      runId: 'unpriced-run',
      projectId: 'proj-mixed',
      conversationId: 'conv-1',
      agentId: 'antigravity',
      record: computeRunUsageRecord({
        requestedRaw: 'Gemini 3.1 Pro (High)', resolvedRaw: 'Gemini 3.1 Pro (High)', reportedRaw: null,
        agentId: 'antigravity',
        events: [],
      }),
    });
    const summary = projectUsageSummary(db, 'proj-mixed');
    expect(summary.pricingVersion).toBe('partial');
    expect(summary.totalCostUsd).not.toBeNull();
    expect(summary.runCount).toBe(2);
    expect(summary.pricedRunCount).toBe(1);
  });

  it('reports unavailable (not $0.00) for a project with zero priced runs', () => {
    recordRunUsage(db, {
      runId: 'unpriced-only',
      projectId: 'proj-unpriced',
      conversationId: 'conv-1',
      agentId: 'antigravity',
      record: computeRunUsageRecord({
        requestedRaw: 'Gemini 3.1 Pro (High)', resolvedRaw: 'Gemini 3.1 Pro (High)', reportedRaw: null,
        agentId: 'antigravity',
        events: [],
      }),
    });
    const summary = projectUsageSummary(db, 'proj-unpriced');
    expect(summary.pricingVersion).toBe('unavailable');
    expect(summary.totalCostUsd).toBeNull();
  });

  it('survives a fresh Database handle against the same file (daemon-restart durability)', () => {
    const file = `${require('node:os').tmpdir()}/usage-tracking-restart-${Date.now()}.sqlite`;
    const first = new Database(file);
    ensureUsageTable(first);
    recordRunUsage(first, {
      runId: 'restart-run',
      projectId: 'proj-restart',
      conversationId: 'conv-1',
      agentId: 'claude',
      record: computeRunUsageRecord({
        requestedRaw: 'claude-sonnet-4-5', resolvedRaw: 'claude-sonnet-4-5', reportedRaw: 'claude-sonnet-4-5',
        agentId: 'claude',
        events: [agentUsageEvent({ input_tokens: 500, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 })],
      }),
    });
    first.close();

    const second = new Database(file);
    ensureUsageTable(second);
    const rows = listProjectRunUsage(second, 'proj-restart');
    second.close();
    require('node:fs').unlinkSync(file);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.runId).toBe('restart-run');
  });
});
