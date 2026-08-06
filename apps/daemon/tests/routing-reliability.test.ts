// L1 reliability layer coverage (WR wave, P2 tranche -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.2 L1 + §3.1 side-effect
// redispatch limits). Three independent surfaces: cooldown recording +
// exponential backoff (SQLite-backed, isolation pattern mirrors
// routing-telemetry-storage.test.ts -- fresh mkdtemp data dir per test),
// lane-ordered fallback chain lookup (pure, over the real shipped policy),
// and non-redispatchable side-effect marking.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RoutingPolicyCooldownConfig } from '@open-design/contracts';

import { closeDatabase, openDatabase } from '../src/db.js';
import { TRANSPORT_TIER } from '../src/routing/decision.js';
import { loadRoutingPolicy } from '../src/routing/policy.js';
import {
  clearOnSuccess,
  computeCooldownStatuses,
  computeCooldownWindowMs,
  DEFAULT_COOLDOWN_CONFIG,
  ensureRoutingCooldownsTable,
  ensureRoutingRunSideEffectsTable,
  findActiveCooldown,
  getCooldownRecord,
  getRunRedispatchability,
  getRunSideEffectKinds,
  isInCooldown,
  isRedispatchable,
  laneFallbackChain,
  markRunSideEffects,
  nextLaneInChain,
  recordObservedFailure,
} from '../src/routing/reliability.js';

const CONFIG: RoutingPolicyCooldownConfig = { baseMs: 1_000, factor: 2, maxMs: 10_000 };

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-reliability-'));
});

afterEach(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('ensureRoutingCooldownsTable / ensureRoutingRunSideEffectsTable', () => {
  it('are idempotent -- calling either twice does not throw or duplicate schema', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    expect(() => ensureRoutingCooldownsTable(db)).not.toThrow();
    expect(() => ensureRoutingCooldownsTable(db)).not.toThrow();
    expect(() => ensureRoutingRunSideEffectsTable(db)).not.toThrow();
    expect(() => ensureRoutingRunSideEffectsTable(db)).not.toThrow();
  });
});

describe('recordObservedFailure / computeCooldownWindowMs -- exponential growth', () => {
  it('the window after 2 consecutive failures is longer than after 1 (same base/factor)', () => {
    const one = computeCooldownWindowMs(1, CONFIG);
    const two = computeCooldownWindowMs(2, CONFIG);
    expect(one).toBe(1_000);
    expect(two).toBe(2_000);
    expect(two).toBeGreaterThan(one);
  });

  it('caps the window at maxMs regardless of how many consecutive failures accumulate', () => {
    expect(computeCooldownWindowMs(10, CONFIG)).toBe(CONFIG.maxMs);
    expect(computeCooldownWindowMs(100, CONFIG)).toBe(CONFIG.maxMs);
  });

  it('is 0 for zero or negative consecutive failures -- no window to speak of', () => {
    expect(computeCooldownWindowMs(0, CONFIG)).toBe(0);
    expect(computeCooldownWindowMs(-1, CONFIG)).toBe(0);
  });

  it('recordObservedFailure increments consecutive_failures on the SAME scope across repeated calls, growing the cooldown window', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingCooldownsTable(db);
    const t0 = new Date('2026-08-05T00:00:00.000Z');
    recordObservedFailure(db, 'claude-code', 'claude-code-oauth', 'process_exit', t0);
    const afterOne = getCooldownRecord(db, 'runtime', 'claude-code');
    expect(afterOne?.consecutiveFailures).toBe(1);

    recordObservedFailure(db, 'claude-code', 'claude-code-oauth', 'rate_limit', new Date('2026-08-05T00:00:01.000Z'));
    const afterTwo = getCooldownRecord(db, 'runtime', 'claude-code');
    expect(afterTwo?.consecutiveFailures).toBe(2);
    expect(afterTwo?.category).toBe('rate_limit'); // most recent category wins.
  });
});

describe('clearOnSuccess -- resets consecutive-failure count', () => {
  it('a success on the same (runtimeId, lane) pair resets both scopes to 0 consecutive failures', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingCooldownsTable(db);
    const now = new Date('2026-08-05T00:00:00.000Z');
    recordObservedFailure(db, 'claude-code', 'claude-code-oauth', 'timeout', now);
    recordObservedFailure(db, 'claude-code', 'claude-code-oauth', 'timeout', now);
    expect(getCooldownRecord(db, 'runtime', 'claude-code')?.consecutiveFailures).toBe(2);
    expect(getCooldownRecord(db, 'lane', 'claude-code-oauth')?.consecutiveFailures).toBe(2);

    clearOnSuccess(db, 'claude-code', 'claude-code-oauth', now);
    expect(getCooldownRecord(db, 'runtime', 'claude-code')?.consecutiveFailures).toBe(0);
    expect(getCooldownRecord(db, 'lane', 'claude-code-oauth')?.consecutiveFailures).toBe(0);
    expect(isInCooldown(db, { type: 'runtime', id: 'claude-code' }, CONFIG, now).inCooldown).toBe(false);
  });
});

describe('isInCooldown -- boundary at exactly expiry, injected clock, no Date.now in pure logic', () => {
  it('is in cooldown strictly before the window expires', () => {
    const record = { scopeType: 'runtime' as const, scopeId: 'r1', category: 'rate_limit', consecutiveFailures: 1, lastFailureAtMs: 0 };
    const justBefore = new Date(CONFIG.baseMs - 1);
    expect(isInCooldown(record, CONFIG, justBefore).inCooldown).toBe(true);
    expect(isInCooldown(record, CONFIG, justBefore).remainingMs).toBe(1);
  });

  it('is NOT in cooldown at exactly the expiry instant (exclusive upper bound)', () => {
    const record = { scopeType: 'runtime' as const, scopeId: 'r1', category: 'rate_limit', consecutiveFailures: 1, lastFailureAtMs: 0 };
    const exactlyAtExpiry = new Date(CONFIG.baseMs);
    const check = isInCooldown(record, CONFIG, exactlyAtExpiry);
    expect(check.inCooldown).toBe(false);
    expect(check.remainingMs).toBe(0);
  });

  it('a null record (no observed failures) is never in cooldown', () => {
    expect(isInCooldown(null, CONFIG, new Date()).inCooldown).toBe(false);
  });

  it('a record with consecutiveFailures 0 (reset by clearOnSuccess) is never in cooldown, regardless of a stale lastFailureAtMs', () => {
    const record = { scopeType: 'runtime' as const, scopeId: 'r1', category: 'rate_limit', consecutiveFailures: 0, lastFailureAtMs: 0 };
    expect(isInCooldown(record, CONFIG, new Date(1)).inCooldown).toBe(false);
  });
});

describe('per-runtime vs per-lane independence', () => {
  it('a runtime failing across two different lanes advances the RUNTIME scope once per call but each LANE scope only once', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingCooldownsTable(db);
    const now = new Date('2026-08-05T00:00:00.000Z');
    recordObservedFailure(db, 'claude-code', 'claude-code-oauth', 'process_exit', now);
    recordObservedFailure(db, 'claude-code', 'nous', 'process_exit', now);
    expect(getCooldownRecord(db, 'runtime', 'claude-code')?.consecutiveFailures).toBe(2);
    expect(getCooldownRecord(db, 'lane', 'claude-code-oauth')?.consecutiveFailures).toBe(1);
    expect(getCooldownRecord(db, 'lane', 'nous')?.consecutiveFailures).toBe(1);
  });

  it('a lane failing across two different runtimes advances the LANE scope once per call but each RUNTIME scope only once, and clearing one scope does not affect the other', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingCooldownsTable(db);
    const now = new Date('2026-08-05T00:00:00.000Z');
    recordObservedFailure(db, 'claude-code', 'moonshot', 'upstream_unavailable', now);
    recordObservedFailure(db, 'codex', 'moonshot', 'upstream_unavailable', now);
    expect(getCooldownRecord(db, 'lane', 'moonshot')?.consecutiveFailures).toBe(2);
    expect(getCooldownRecord(db, 'runtime', 'claude-code')?.consecutiveFailures).toBe(1);
    expect(getCooldownRecord(db, 'runtime', 'codex')?.consecutiveFailures).toBe(1);

    clearOnSuccess(db, 'claude-code', 'moonshot', now);
    // clearOnSuccess resets BOTH scopes it names (runtimeId=claude-code,
    // lane=moonshot) -- the lane scope resets even though "codex" also
    // contributed to it, matching this task's own brief
    // (clearOnSuccess(runtimeId, lane, clock)).
    expect(getCooldownRecord(db, 'runtime', 'claude-code')?.consecutiveFailures).toBe(0);
    expect(getCooldownRecord(db, 'lane', 'moonshot')?.consecutiveFailures).toBe(0);
    // codex's own runtime scope is untouched by a claude-code/moonshot success.
    expect(getCooldownRecord(db, 'runtime', 'codex')?.consecutiveFailures).toBe(1);
  });
});

describe('computeCooldownStatuses -- meters surface', () => {
  it('lists only scopes with recorded failures, reflecting current inCooldown status against the injected clock', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingCooldownsTable(db);
    const t0 = new Date('2026-08-05T00:00:00.000Z');
    recordObservedFailure(db, 'claude-code', 'claude-code-oauth', 'process_exit', t0);

    const stillCooling = computeCooldownStatuses(db, CONFIG, new Date(t0.getTime() + CONFIG.baseMs - 1));
    expect(stillCooling.some((s) => s.scopeType === 'runtime' && s.scopeId === 'claude-code' && s.inCooldown)).toBe(true);

    const expired = computeCooldownStatuses(db, CONFIG, new Date(t0.getTime() + CONFIG.baseMs + 1));
    const runtimeStatus = expired.find((s) => s.scopeType === 'runtime' && s.scopeId === 'claude-code');
    expect(runtimeStatus?.inCooldown).toBe(false);
    expect(runtimeStatus?.consecutiveFailures).toBe(1); // still listed -- history persists past window expiry.
  });

  it('self-ensures the table -- callable on a fresh db that never called ensureRoutingCooldownsTable itself', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    expect(() => computeCooldownStatuses(db, CONFIG, new Date())).not.toThrow();
  });
});

describe('findActiveCooldown -- pure candidate-side lookup over a snapshot', () => {
  it('finds an active RUNTIME cooldown for the candidate', () => {
    const statuses = [
      { scopeType: 'runtime' as const, scopeId: 'claude-code', inCooldown: true, remainingMs: 500, consecutiveFailures: 1, category: 'rate_limit', reason: 'cooling' },
    ];
    const hit = findActiveCooldown(statuses, { runtimeId: 'claude-code', lane: 'claude-code-oauth' });
    expect(hit?.scopeType).toBe('runtime');
  });

  it('finds an active LANE cooldown when the runtime is clear', () => {
    const statuses = [
      { scopeType: 'lane' as const, scopeId: 'nous', inCooldown: true, remainingMs: 500, consecutiveFailures: 1, category: 'timeout', reason: 'cooling' },
    ];
    const hit = findActiveCooldown(statuses, { runtimeId: 'grok-cli', lane: 'nous' });
    expect(hit?.scopeType).toBe('lane');
  });

  it('returns null when neither the runtime nor the lane is in cooldown', () => {
    const statuses = [
      { scopeType: 'runtime' as const, scopeId: 'claude-code', inCooldown: false, remainingMs: 0, consecutiveFailures: 1, category: 'rate_limit', reason: 'clear' },
    ];
    expect(findActiveCooldown(statuses, { runtimeId: 'claude-code', lane: 'nous' })).toBeNull();
  });
});

describe('laneFallbackChain / nextLaneInChain -- lane-ordered fallback (plan §3.2 L1)', () => {
  const realPolicy = loadRoutingPolicy();

  it('excludes fromLane itself and preserves the remaining chain order', () => {
    const chain = laneFallbackChain(realPolicy, 'claude-code-oauth');
    expect(chain[0]).not.toBe('claude-code-oauth');
    expect(chain).toEqual(['nous', 'moonshot', 'deepseek-direct', 'openrouter']);
  });

  it('nextLaneInChain returns the immediate next lane', () => {
    expect(nextLaneInChain(realPolicy, 'claude-code-oauth')).toBe('nous');
    expect(nextLaneInChain(realPolicy, 'moonshot')).toBe('deepseek-direct');
  });

  it('end-of-chain: the last lane in its own chain has no next lane', () => {
    expect(laneFallbackChain(realPolicy, 'openrouter')).toEqual([]);
    expect(nextLaneInChain(realPolicy, 'openrouter')).toBeNull();
  });

  it('an unknown lane (no chain entry) returns an empty chain / null next lane', () => {
    expect(laneFallbackChain(realPolicy, 'not-a-real-lane')).toEqual([]);
    expect(nextLaneInChain(realPolicy, 'not-a-real-lane')).toBeNull();
  });

  it('every lane chain in the real policy is ordered by non-decreasing TRANSPORT_TIER (reuses decision.ts\'s own tier map, never a duplicate)', () => {
    for (const [fromLane, chain] of Object.entries(realPolicy.laneChains)) {
      const candidate = realPolicy.modelTable
        .flatMap((entry) => [entry.primary, entry.burst, entry.cheap])
        .find((c) => c?.lane === fromLane);
      // Not every lane in laneChains necessarily appears as a candidate in
      // this policy version's modelTable -- skip if we can't resolve a
      // transport for it rather than asserting on unavailable data.
      if (!candidate) continue;
      const tiers = chain
        .map((lane) => {
          const c = realPolicy.modelTable.flatMap((entry) => [entry.primary, entry.burst, entry.cheap]).find((x) => x?.lane === lane);
          return c ? TRANSPORT_TIER[c.transport] : undefined;
        })
        .filter((t): t is number => t !== undefined);
      for (let i = 1; i < tiers.length; i += 1) {
        expect(tiers[i]).toBeGreaterThanOrEqual(tiers[i - 1]!);
      }
    }
  });
});

describe('non-redispatchable side-effect marking (plan §3.1)', () => {
  it('a fresh run with no marking is redispatchable and requires no human ack', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingRunSideEffectsTable(db);
    expect(isRedispatchable(db, 'run-fresh')).toBe(true);
    expect(getRunRedispatchability(db, 'run-fresh')).toEqual({
      runId: 'run-fresh',
      redispatchable: true,
      sideEffectKinds: [],
      requiresHumanAck: false,
    });
  });

  it('markRunSideEffects round-trips: isRedispatchable becomes false and requiresHumanAck becomes true', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingRunSideEffectsTable(db);
    const now = new Date('2026-08-05T00:00:00.000Z');
    markRunSideEffects(db, 'run-1', ['git-push'], now);

    expect(isRedispatchable(db, 'run-1')).toBe(false);
    const status = getRunRedispatchability(db, 'run-1');
    expect(status.redispatchable).toBe(false);
    expect(status.requiresHumanAck).toBe(true);
    expect(status.sideEffectKinds).toEqual(['git-push']);
    expect(getRunSideEffectKinds(db, 'run-1')).toEqual(['git-push']);
  });

  it('accumulates kinds across multiple calls (a later attempt discovering a new side effect) rather than overwriting', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingRunSideEffectsTable(db);
    const now = new Date('2026-08-05T00:00:00.000Z');
    markRunSideEffects(db, 'run-2', ['db-migration'], now);
    markRunSideEffects(db, 'run-2', ['supabase-change'], now);
    expect(getRunSideEffectKinds(db, 'run-2').sort()).toEqual(['db-migration', 'supabase-change']);
  });

  it('deduplicates a repeated kind', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingRunSideEffectsTable(db);
    const now = new Date('2026-08-05T00:00:00.000Z');
    markRunSideEffects(db, 'run-3', ['network-call'], now);
    markRunSideEffects(db, 'run-3', ['network-call'], now);
    expect(getRunSideEffectKinds(db, 'run-3')).toEqual(['network-call']);
  });

  it('marking with zero valid kinds is a no-op -- the run stays redispatchable', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingRunSideEffectsTable(db);
    markRunSideEffects(db, 'run-4', [], new Date());
    expect(isRedispatchable(db, 'run-4')).toBe(true);
  });
});

// Default cooldown config -- sanity that the shipped default is a real,
// exponentially-growing, capped configuration (not an accidental 0/1/0).
describe('DEFAULT_COOLDOWN_CONFIG', () => {
  it('produces a growing, capped window sequence', () => {
    const one = computeCooldownWindowMs(1, DEFAULT_COOLDOWN_CONFIG);
    const two = computeCooldownWindowMs(2, DEFAULT_COOLDOWN_CONFIG);
    expect(two).toBeGreaterThan(one);
    expect(computeCooldownWindowMs(1000, DEFAULT_COOLDOWN_CONFIG)).toBe(DEFAULT_COOLDOWN_CONFIG.maxMs);
  });
});
