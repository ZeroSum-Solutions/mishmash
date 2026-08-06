// L4 admission control (WR wave, P2 tranche -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.1 budget bullet, §3.2 L4).
// Table-driven coverage for the pure core in
// apps/daemon/src/routing/admission.ts: `evaluateAdmission` and
// `estimatedRunCostUsd` build every input in memory (no I/O, no SQLite);
// the spend-lookup describe block at the bottom is the one place this file
// touches a real database, seeding apps/daemon/src/routing/telemetry.ts's
// `routing_telemetry` table and asserting `computeStageSpendUsd`/
// `computeBuildSpendUsd`/`computeDaySpendUsd` aggregate exactly what
// admission control needs.
//
// Sol fix-round (post-t6 adversarial review) folded in here, RED-then-GREEN
// confirmed against admission.ts before the fix landed:
//   - HIGH-1: cost estimation now prices BOTH input and output tokens (see
//     "estimatedRunCostUsd -- pricing" below); the primary pricing test IS
//     the former red case (opus-5, 300k tokens, default output bound).
//   - HIGH-2: the stage-ceiling check now accounts for spend already
//     recorded against this build's this stage (see "denies at the stage
//     ceiling" and the dedicated HIGH-2 case in the verdict-taxonomy block).
//   - LOW-7: a clock predating every dated price row is `not-evaluated`,
//     not a silent fallback to the earliest row.
//   - LOW-8: the stage-ceiling boundary case below is a true one-cent
//     overage, and the Gemini threshold boundary is asserted exactly at
//     200,000 tokens (base rate) vs 200,001 (doubled).
//
// Most `evaluateAdmission`/`estimatedRunCostUsd` cases below deliberately
// zero out `budgetCeilings.outputTokenBound` (`ZERO_OUTPUT_BOUND`) so their
// numbers isolate the mechanism under test (cap comparison, date-row
// selection, threshold-on-input) from HIGH-1's output-pricing addition,
// which has its own dedicated tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RoutingCandidate, RoutingPolicyDocument, StoredRoutingTelemetryRow } from '@open-design/contracts';

import {
  estimatedRunCostUsd,
  evaluateAdmission,
  maxVariationFanout,
  RoutingAdmissionInputError,
  runawayLimitsFor,
  type AdmissionSpendLookup,
  type EvaluateAdmissionInput,
} from '../src/routing/admission.js';
import { closeDatabase, openDatabase } from '../src/db.js';
import {
  computeBuildSpendUsd,
  computeDaySpendUsd,
  computeStageSpendUsd,
  ensureRoutingTelemetryTable,
  recordRoutingTelemetry,
} from '../src/routing/telemetry.js';

const ZERO_OUTPUT_BOUND = { default: 0 };

function candidate(overrides: Partial<RoutingCandidate> = {}): RoutingCandidate {
  return {
    runtimeId: 'claude',
    model: 'claude-opus-5',
    effort: 'inherit',
    lane: 'claude-code-oauth',
    transport: 'subscription-oauth',
    modelFamily: 'anthropic',
    ...overrides,
  };
}

function policy(overrides: Partial<RoutingPolicyDocument> = {}): RoutingPolicyDocument {
  return {
    policyVersion: 1,
    stageVocabulary: ['chat', 'classify'],
    modelTable: [],
    hardConstraints: [],
    laneChains: {},
    dataClassificationAllowlists: [],
    sonnetPriceRows: [
      { model: 'claude-sonnet-5', inputPerMillion: 2, outputPerMillion: 10, effectiveDate: '2026-01-01' },
      { model: 'claude-sonnet-5', inputPerMillion: 3, outputPerMillion: 15, effectiveDate: '2026-08-31' },
    ],
    otherModelPriceRows: [
      { model: 'claude-opus-5', inputPerMillion: 5, outputPerMillion: 25 },
      { model: 'claude-haiku-4-5', inputPerMillion: 1, outputPerMillion: 5 },
      { model: 'deepseek-v4-flash', inputPerMillion: 0.14, outputPerMillion: 0.28 },
      { model: 'Gemini 3.1 Pro (High)', inputPerMillion: 2, outputPerMillion: 12, thresholdedPricing: { thresholdTokens: 200_000, multiplier: 2 } },
    ],
    budgetCeilings: {
      perStageEstimatedCostUsd: { chat: 1 },
      perBuildCapUsd: 100,
      perDayCapUsd: 100,
      meteredKillSwitch: false,
    },
    ...overrides,
  };
}

/** A `policy()` fixture with output pricing disabled (`outputTokenBound:
 * {default: 0}`) -- isolates cap-comparison/date/threshold-selection tests
 * from HIGH-1's input+output pricing formula, which has its own dedicated
 * tests below. */
function policyZeroOutput(overrides: Partial<RoutingPolicyDocument> = {}): RoutingPolicyDocument {
  const base = policy(overrides);
  return { ...base, budgetCeilings: { ...base.budgetCeilings, outputTokenBound: overrides.budgetCeilings?.outputTokenBound ?? ZERO_OUTPUT_BOUND } };
}

const NOW = new Date('2026-08-05T00:00:00.000Z');
const NO_SPEND: AdmissionSpendLookup = { stageSpentUsd: 0, buildSpentUsd: 0, daySpentUsd: 0 };

function input(overrides: Partial<EvaluateAdmissionInput> = {}): EvaluateAdmissionInput {
  return {
    policy: policyZeroOutput(),
    stage: 'chat',
    taskClass: 'test-class',
    candidate: candidate(),
    contextEstimateTokens: 0,
    buildId: 'build-1',
    spendLookup: NO_SPEND,
    now: NOW,
    ...overrides,
  };
}

describe('estimatedRunCostUsd -- pricing', () => {
  // Sol review HIGH-1 (fix-round): the primary pricing test. opus-5: $5/M
  // input, $25/M output. 300k input tokens; default output bound (32_000,
  // since no outputTokenBound is configured) applies. Input-only (the
  // pre-fix bug) gave $1.50; correctly priced: 1.5 + 32_000/1e6*25 (=0.8)
  // = $2.30.
  it('prices BOTH input and output tokens using the matched otherModelPriceRows row', () => {
    const cost = estimatedRunCostUsd(candidate({ model: 'claude-opus-5' }), 300_000, policy(), NOW);
    expect(cost).toBeCloseTo(2.3, 10);
  });

  it('an explicit outputTokenBound.default overrides the hardcoded 32_000 fallback', () => {
    const p = policy({ budgetCeilings: { ...policy().budgetCeilings, outputTokenBound: { default: 10_000 } } });
    // opus-5 @ 300k input, 10k output bound: 1.5 + 10_000/1e6*25 (=0.25) = 1.75.
    expect(estimatedRunCostUsd(candidate({ model: 'claude-opus-5' }), 300_000, p, NOW)).toBeCloseTo(1.75, 10);
  });

  it('a perTaskClass override wins over outputTokenBound.default for that taskClass', () => {
    const p = policy({ budgetCeilings: { ...policy().budgetCeilings, outputTokenBound: { default: 32_000, perTaskClass: { chat: 0 } } } });
    // opus-5 @ 300k input, output bound 0 for taskClass "chat": 1.5 + 0 = 1.5.
    expect(estimatedRunCostUsd(candidate({ model: 'claude-opus-5' }), 300_000, p, NOW, 'chat')).toBeCloseTo(1.5, 10);
    // A different (or absent) taskClass still gets the 32_000 default.
    expect(estimatedRunCostUsd(candidate({ model: 'claude-opus-5' }), 300_000, p, NOW, 'other-class')).toBeCloseTo(2.3, 10);
  });

  it('DeepSeek V4-Flash prices at its single cache-miss anchor row ($0.14/M input) -- isolated via a zero output bound', () => {
    const cost = estimatedRunCostUsd(
      candidate({ model: 'deepseek-v4-flash', transport: 'metered-api', lane: 'deepseek-direct', modelFamily: 'deepseek' }),
      1_000_000,
      policyZeroOutput(),
      NOW,
    );
    expect(cost).toBeCloseTo(0.14, 10);
  });

  it('Gemini thresholdedPricing: below 200k tokens uses the base input rate -- isolated via a zero output bound', () => {
    const cost = estimatedRunCostUsd(candidate({ model: 'Gemini 3.1 Pro (High)', lane: 'agy', modelFamily: 'google' }), 100_000, policyZeroOutput(), NOW);
    expect(cost).toBeCloseTo(0.2, 10); // 100k/1M * $2
  });

  it('Gemini thresholdedPricing: above 200k tokens doubles the effective input rate -- isolated via a zero output bound', () => {
    const cost = estimatedRunCostUsd(candidate({ model: 'Gemini 3.1 Pro (High)', lane: 'agy', modelFamily: 'google' }), 300_000, policyZeroOutput(), NOW);
    expect(cost).toBeCloseTo(1.2, 10); // 300k/1M * ($2 * 2)
  });

  // Sol review LOW-8: the threshold boundary itself, exact -- documents
  // which side prices at the base rate (findPriceRow/estimatedRunCostUsd's
  // own comment: EXCLUSIVE, only STRICTLY GREATER than thresholdTokens
  // multiplies).
  it('Gemini thresholdedPricing boundary is exclusive: exactly 200,000 tokens is the base rate, 200,001 is doubled', () => {
    const atThreshold = estimatedRunCostUsd(candidate({ model: 'Gemini 3.1 Pro (High)', lane: 'agy', modelFamily: 'google' }), 200_000, policyZeroOutput(), NOW);
    expect(atThreshold).toBeCloseTo(0.4, 10); // 200_000/1e6 * $2, base rate
    const overThreshold = estimatedRunCostUsd(candidate({ model: 'Gemini 3.1 Pro (High)', lane: 'agy', modelFamily: 'google' }), 200_001, policyZeroOutput(), NOW);
    expect(overThreshold).toBeCloseTo(0.800004, 10); // 200_001/1e6 * $4 (doubled)
  });

  it('thresholdedPricing multiplies the OUTPUT rate too, not just input (Gemini\'s real long-context surcharge is symmetric)', () => {
    // Gemini @ 300k tokens, default 32_000 output bound, threshold exceeded:
    // input 300_000/1e6*4=1.2, output 32_000/1e6*24(=12*2)=0.768 -> 1.968.
    const cost = estimatedRunCostUsd(candidate({ model: 'Gemini 3.1 Pro (High)', lane: 'agy', modelFamily: 'google' }), 300_000, policy(), NOW);
    expect(cost).toBeCloseTo(1.968, 10);
  });

  it('Sonnet date-boundary row selection: just before 2026-08-31 uses the $2/$10-per-M row', () => {
    // 1,000,000 input tokens, default 32_000 output bound: input=2, output=32_000/1e6*10=0.32 -> 2.32.
    const cost = estimatedRunCostUsd(candidate({ model: 'claude-sonnet-5' }), 1_000_000, policy(), new Date('2026-08-30T23:59:59.999Z'));
    expect(cost).toBeCloseTo(2.32, 10);
  });

  it('Sonnet date-boundary row selection: exactly at 2026-08-31T00:00:00Z uses the new $3/$15-per-M row', () => {
    // input=3, output=32_000/1e6*15=0.48 -> 3.48.
    const cost = estimatedRunCostUsd(candidate({ model: 'claude-sonnet-5' }), 1_000_000, policy(), new Date('2026-08-31T00:00:00.000Z'));
    expect(cost).toBeCloseTo(3.48, 10);
  });

  // Sol review LOW-7 (fix-round): a clock before EVERY dated row for a
  // model must never fall back to the earliest row's price -- that would
  // fabricate a price for an instant this policy never actually priced.
  it('returns null when now predates every dated price row for the model (never falls back to the earliest row)', () => {
    const cost = estimatedRunCostUsd(candidate({ model: 'claude-sonnet-5' }), 1_000_000, policy(), new Date('2025-12-31T23:59:59.999Z'));
    expect(cost).toBeNull();
  });

  it('returns null (never a fabricated price) for a model with no price row anywhere in the policy (Kimi K3)', () => {
    const cost = estimatedRunCostUsd(
      candidate({ runtimeId: 'kimi', model: 'moonshotai/kimi-k3', lane: 'moonshot', transport: 'prepaid', modelFamily: 'moonshot' }),
      100_000,
      policy(),
      NOW,
    );
    expect(cost).toBeNull();
  });

  it('throws a typed RoutingAdmissionInputError on a NaN contextEstimateTokens -- never silently prices garbage', () => {
    expect(() => estimatedRunCostUsd(candidate(), Number.NaN, policy(), NOW)).toThrow(RoutingAdmissionInputError);
  });

  it('throws on a negative contextEstimateTokens', () => {
    expect(() => estimatedRunCostUsd(candidate(), -1, policy(), NOW)).toThrow(RoutingAdmissionInputError);
  });

  it('throws on a fractional contextEstimateTokens', () => {
    expect(() => estimatedRunCostUsd(candidate(), 1.5, policy(), NOW)).toThrow(RoutingAdmissionInputError);
  });

  it('throws on an invalid Date', () => {
    expect(() => estimatedRunCostUsd(candidate(), 100, policy(), new Date('not-a-date'))).toThrow(RoutingAdmissionInputError);
  });
});

describe('evaluateAdmission -- verdict taxonomy', () => {
  it('admits a candidate whose estimated cost fits comfortably under every cap', () => {
    const r = evaluateAdmission(input({ contextEstimateTokens: 100_000 })); // opus-5 (zero-output policy) -> $0.50
    expect(r.verdict).toBe('admit');
    expect(r.estimatedCostUsd).toBeCloseTo(0.5, 10);
    expect(r).toMatchObject({ runtimeId: 'claude', model: 'claude-opus-5', lane: 'claude-code-oauth' });
  });

  // Sol review LOW-8: a true one-cent overage (202k tokens), not merely
  // "one extra token."
  it('denies at the stage ceiling, boundary-exact: exactly at the $1.00 ceiling admits, a true one-cent overage denies', () => {
    // opus-5 $5/M -> 200k tokens = exactly $1.00, the stage's ceiling.
    const atBoundary = evaluateAdmission(input({ contextEstimateTokens: 200_000 }));
    expect(atBoundary.verdict).toBe('admit');
    expect(atBoundary.estimatedCostUsd).toBeCloseTo(1.0, 10);
    // 202,000 tokens @ $5/M = $1.01 -- a true one-cent overage, not a
    // one-token rounding artifact.
    const overBoundary = evaluateAdmission(input({ contextEstimateTokens: 202_000 }));
    expect(overBoundary.verdict).toBe('deny-stage-ceiling');
    expect(overBoundary.estimatedCostUsd).toBeCloseTo(1.01, 10);
  });

  // Sol review HIGH-2: the case that used to be a RED probe -- kept here as
  // the permanent regression test.
  it('HIGH-2: the stage ceiling accounts for spend already recorded against this build+stage, not a hardcoded 0', () => {
    const p = policy({ budgetCeilings: { perStageEstimatedCostUsd: { chat: 3.5 }, perBuildCapUsd: 100, perDayCapUsd: 100, meteredKillSwitch: false, outputTokenBound: { default: 100_000 } } });
    // opus-5 @ 100k tokens with a 100k output bound: input 0.5 + output 2.5 = $3.00.
    // Stage already spent $3.15 (90% of the $3.50 cap) -- 3.15+3.00=6.15 > 3.50, must deny;
    // a 0-spend comparison would see 0+3.00 <= 3.50 and wrongly admit.
    const r = evaluateAdmission(input({ policy: p, contextEstimateTokens: 100_000, spendLookup: { stageSpentUsd: 3.15, buildSpentUsd: 0, daySpentUsd: 0 } }));
    expect(r.verdict).toBe('deny-stage-ceiling');
    expect(r.estimatedCostUsd).toBeCloseTo(3.0, 10);
  });

  it('a stage with no perStageEstimatedCostUsd entry has no stage ceiling to check (policy decision, not not-evaluated)', () => {
    const r = evaluateAdmission(
      input({
        stage: 'classify', // deliberately absent from perStageEstimatedCostUsd
        contextEstimateTokens: 1_000_000, // would blow any real ceiling
        buildId: null, // also skip the build check so only stage/day matter
      }),
    );
    expect(r.verdict).toBe('admit');
  });

  it('denies at the build cap, boundary-exact', () => {
    const p = policyZeroOutput({ budgetCeilings: { perStageEstimatedCostUsd: { chat: 1000 }, perBuildCapUsd: 10, perDayCapUsd: 1000, meteredKillSwitch: false } });
    // opus-5 $5/M -> 200k tokens = $1.00; already spent $9 -> exactly at the $10 build cap.
    const atBoundary = evaluateAdmission(input({ policy: p, contextEstimateTokens: 200_000, spendLookup: { stageSpentUsd: 0, buildSpentUsd: 9, daySpentUsd: 0 } }));
    expect(atBoundary.verdict).toBe('admit');
    const overBoundary = evaluateAdmission(input({ policy: p, contextEstimateTokens: 200_000, spendLookup: { stageSpentUsd: 0, buildSpentUsd: 9.01, daySpentUsd: 0 } }));
    expect(overBoundary.verdict).toBe('deny-build-cap');
  });

  it('skips the build cap entirely when buildId is null (non-build-scoped work, e.g. general chat)', () => {
    const p = policyZeroOutput({ budgetCeilings: { perStageEstimatedCostUsd: { chat: 1000 }, perBuildCapUsd: 0.01, perDayCapUsd: 1000, meteredKillSwitch: false } });
    const r = evaluateAdmission(input({ policy: p, buildId: null, contextEstimateTokens: 100_000, spendLookup: { stageSpentUsd: 0, buildSpentUsd: 999, daySpentUsd: 0 } }));
    expect(r.verdict).toBe('admit');
  });

  it('denies at the day cap, boundary-exact', () => {
    const p = policyZeroOutput({ budgetCeilings: { perStageEstimatedCostUsd: { chat: 1000 }, perBuildCapUsd: 1000, perDayCapUsd: 10, meteredKillSwitch: false } });
    const atBoundary = evaluateAdmission(input({ policy: p, contextEstimateTokens: 200_000, spendLookup: { stageSpentUsd: 0, buildSpentUsd: 0, daySpentUsd: 9 } }));
    expect(atBoundary.verdict).toBe('admit');
    const overBoundary = evaluateAdmission(input({ policy: p, contextEstimateTokens: 200_000, spendLookup: { stageSpentUsd: 0, buildSpentUsd: 0, daySpentUsd: 9.01 } }));
    expect(overBoundary.verdict).toBe('deny-day-cap');
  });

  it('headroomFraction shifts the effective boundary down from the nominal cap', () => {
    const p = policyZeroOutput({
      budgetCeilings: { perStageEstimatedCostUsd: { chat: 1000 }, perBuildCapUsd: 10, perDayCapUsd: 1000, meteredKillSwitch: false, headroomFraction: 0.1, outputTokenBound: ZERO_OUTPUT_BOUND },
    });
    // effective cap = 10 * (1 - 0.1) = 9.
    const atNewBoundary = evaluateAdmission(input({ policy: p, contextEstimateTokens: 1_800_000, spendLookup: NO_SPEND })); // opus-5 -> $9.00
    expect(atNewBoundary.verdict).toBe('admit');
    const justOverNewBoundary = evaluateAdmission(input({ policy: p, contextEstimateTokens: 1_800_100, spendLookup: NO_SPEND })); // -> $9.0005
    expect(justOverNewBoundary.verdict).toBe('deny-build-cap');
    // Without headroom, the same $9.0005 estimate would still fit under the nominal $10 cap.
    const noHeadroomPolicy = policyZeroOutput({ budgetCeilings: { perStageEstimatedCostUsd: { chat: 1000 }, perBuildCapUsd: 10, perDayCapUsd: 1000, meteredKillSwitch: false } });
    const wouldHaveAdmitted = evaluateAdmission(input({ policy: noHeadroomPolicy, contextEstimateTokens: 1_800_100, spendLookup: NO_SPEND }));
    expect(wouldHaveAdmitted.verdict).toBe('admit');
  });

  it('the metered kill-switch denies a metered-api candidate regardless of cost, but leaves a subscription-oauth candidate untouched', () => {
    const p = policyZeroOutput({ budgetCeilings: { perStageEstimatedCostUsd: { chat: 1000 }, perBuildCapUsd: 1000, perDayCapUsd: 1000, meteredKillSwitch: true } });
    const metered = evaluateAdmission(
      input({
        policy: p,
        candidate: candidate({ runtimeId: 'deepseek', model: 'deepseek-v4-flash', lane: 'deepseek-direct', transport: 'metered-api', modelFamily: 'deepseek' }),
        contextEstimateTokens: 100, // trivially cheap -- proves the kill-switch, not cost, is the reason
      }),
    );
    expect(metered.verdict).toBe('deny-metered-killswitch');
    expect(metered.estimatedCostUsd).not.toBeNull();

    const subscription = evaluateAdmission(input({ policy: p, contextEstimateTokens: 100_000 }));
    expect(subscription.verdict).toBe('admit');
  });

  it('is not-evaluated (never a silent admit) when no price row exists for the candidate model', () => {
    const r = evaluateAdmission(
      input({ candidate: candidate({ runtimeId: 'kimi', model: 'moonshotai/kimi-k3', lane: 'moonshot', transport: 'prepaid', modelFamily: 'moonshot' }) }),
    );
    expect(r.verdict).toBe('not-evaluated');
    expect(r.estimatedCostUsd).toBeNull();
  });

  it('a NaN contextEstimateTokens is a typed error, never a silent admit', () => {
    expect(() => evaluateAdmission(input({ contextEstimateTokens: Number.NaN }))).toThrow(RoutingAdmissionInputError);
  });

  it('a negative spendLookup value is a typed error (stage, build, or day)', () => {
    expect(() => evaluateAdmission(input({ spendLookup: { stageSpentUsd: -1, buildSpentUsd: 0, daySpentUsd: 0 } }))).toThrow(RoutingAdmissionInputError);
    expect(() => evaluateAdmission(input({ spendLookup: { stageSpentUsd: 0, buildSpentUsd: -1, daySpentUsd: 0 } }))).toThrow(RoutingAdmissionInputError);
    expect(() => evaluateAdmission(input({ spendLookup: { stageSpentUsd: 0, buildSpentUsd: 0, daySpentUsd: -1 } }))).toThrow(RoutingAdmissionInputError);
  });

  it('an empty-string buildId is a typed error (use null, not "")', () => {
    expect(() => evaluateAdmission(input({ buildId: '' }))).toThrow(RoutingAdmissionInputError);
  });

  it('an invalid now Date is a typed error', () => {
    expect(() => evaluateAdmission(input({ now: new Date('not-a-date') }))).toThrow(RoutingAdmissionInputError);
  });
});

describe('maxVariationFanout -- Grok F24 fan-out cap', () => {
  it('floors remainingBudget / perVariationEstimate', () => {
    expect(maxVariationFanout(10, 2)).toBe(5);
    expect(maxVariationFanout(10, 3)).toBe(3);
  });

  it('returns 0 for a zero or negative remaining budget', () => {
    expect(maxVariationFanout(0, 2)).toBe(0);
    expect(maxVariationFanout(-5, 2)).toBe(0);
  });

  it('returns 0 for a zero or negative per-variation estimate', () => {
    expect(maxVariationFanout(10, 0)).toBe(0);
    expect(maxVariationFanout(10, -1)).toBe(0);
  });

  it('throws a typed error on a non-finite input', () => {
    expect(() => maxVariationFanout(Number.NaN, 2)).toThrow(RoutingAdmissionInputError);
    expect(() => maxVariationFanout(10, Number.POSITIVE_INFINITY)).toThrow(RoutingAdmissionInputError);
  });
});

describe('runawayLimitsFor -- stream-level runaway heuristics CONFIG round-trip (enforcement is t9)', () => {
  it('returns the stage-specific entry when one exists', () => {
    const p = policy({
      budgetCeilings: {
        ...policy().budgetCeilings,
        runawayLimits: {
          default: { contextGrowthAlarmTokensPerMin: 50_000, wallClockCeilingMs: 900_000, retryCeiling: 3 },
          'section-fanout': { contextGrowthAlarmTokensPerMin: 75_000, wallClockCeilingMs: 1_200_000, retryCeiling: 3 },
        },
      },
    });
    expect(runawayLimitsFor(p, 'section-fanout')).toEqual({ contextGrowthAlarmTokensPerMin: 75_000, wallClockCeilingMs: 1_200_000, retryCeiling: 3 });
  });

  it('falls back to the default entry for a stage with no stage-specific override', () => {
    const p = policy({
      budgetCeilings: {
        ...policy().budgetCeilings,
        runawayLimits: { default: { wallClockCeilingMs: 900_000 } },
      },
    });
    expect(runawayLimitsFor(p, 'chat')).toEqual({ wallClockCeilingMs: 900_000 });
  });

  it('returns {} when runawayLimits is not configured at all', () => {
    expect(runawayLimitsFor(policy(), 'chat')).toEqual({});
  });
});

describe('spend lookup -- computeStageSpendUsd / computeBuildSpendUsd / computeDaySpendUsd against seeded telemetry rows', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'od-routing-admission-spend-'));
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tempDir, { recursive: true, force: true });
  });

  function seedRow(overrides: Partial<StoredRoutingTelemetryRow> = {}): StoredRoutingTelemetryRow {
    return {
      runId: `run-${Math.random().toString(36).slice(2)}`,
      attempt: 0,
      projectId: 'proj-1',
      buildId: 'build-1',
      stage: 'chat',
      templateId: null,
      designSystem: null,
      routedModel: 'claude-sonnet-5',
      observedModel: 'claude-sonnet-5',
      routedLane: 'claude-code-oauth',
      observedLane: 'claude-code-oauth',
      tokens: { input: 100, output: 50, cacheReadInput: 0 },
      cacheHits: 0,
      latencyMs: 1000,
      costUsd: 1,
      costEstimated: false,
      gateOutcomes: {},
      escalated: false,
      policyVersion: 1,
      createdAt: '2026-08-05T12:00:00.000Z',
      recordedAt: '2026-08-05T12:00:05.000Z',
      ...overrides,
    };
  }

  it('sums costUsd (estimated+exact mixed) for one buildId, ignoring rows from a different build or with no build at all', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(db, seedRow({ buildId: 'build-1', costUsd: 1, costEstimated: false }));
    recordRoutingTelemetry(db, seedRow({ buildId: 'build-1', costUsd: 2, costEstimated: true }));
    recordRoutingTelemetry(db, seedRow({ buildId: 'build-2', costUsd: 100, costEstimated: false }));
    recordRoutingTelemetry(db, seedRow({ buildId: null, costUsd: 50, costEstimated: false }));

    const snapshot = computeBuildSpendUsd(db, 'build-1');
    expect(snapshot.totalCostUsd).toBeCloseTo(3, 10);
    expect(snapshot.rowCount).toBe(2);
    expect(snapshot.cost).toBe('mixed'); // one exact row + one estimated row
  });

  it('reports "exact" when every row for the build was billed, and "estimated" when every row was a pre-run estimate', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(db, seedRow({ buildId: 'exact-build', costUsd: 1, costEstimated: false }));
    recordRoutingTelemetry(db, seedRow({ buildId: 'exact-build', costUsd: 1, costEstimated: false }));
    recordRoutingTelemetry(db, seedRow({ buildId: 'estimated-build', costUsd: 1, costEstimated: true }));

    expect(computeBuildSpendUsd(db, 'exact-build').cost).toBe('exact');
    expect(computeBuildSpendUsd(db, 'estimated-build').cost).toBe('estimated');
  });

  it('returns an empty snapshot (0 total, "exact" vacuously) for a build with no rows yet', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    const snapshot = computeBuildSpendUsd(db, 'never-seen-build');
    expect(snapshot).toEqual({ totalCostUsd: 0, rowCount: 0, cost: 'exact' });
  });

  it('sums costUsd within a [dayStart, dayEnd) window, excluding rows outside it (boundary-exclusive at the end)', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    const dayStart = Date.parse('2026-08-05T00:00:00.000Z');
    const dayEnd = Date.parse('2026-08-06T00:00:00.000Z');
    recordRoutingTelemetry(db, seedRow({ createdAt: '2026-08-05T00:00:00.000Z', costUsd: 1, costEstimated: false })); // inclusive start
    recordRoutingTelemetry(db, seedRow({ createdAt: '2026-08-05T23:59:59.999Z', costUsd: 2, costEstimated: true })); // just before end
    recordRoutingTelemetry(db, seedRow({ createdAt: '2026-08-06T00:00:00.000Z', costUsd: 100, costEstimated: false })); // excluded (exclusive end)
    recordRoutingTelemetry(db, seedRow({ createdAt: '2026-08-04T23:59:59.999Z', costUsd: 100, costEstimated: false })); // excluded (before start)

    const snapshot = computeDaySpendUsd(db, dayStart, dayEnd);
    expect(snapshot.totalCostUsd).toBeCloseTo(3, 10);
    expect(snapshot.rowCount).toBe(2);
    expect(snapshot.cost).toBe('mixed');
  });

  // Sol review HIGH-2: computeStageSpendUsd itself, the aggregation
  // evaluateAdmission's stage-ceiling check now reads.
  it('computeStageSpendUsd sums costUsd for one (buildId, stage) pair, ignoring rows for a different stage or a different build in the same stage', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(db, seedRow({ buildId: 'build-1', stage: 'section-fanout', costUsd: 1, costEstimated: false }));
    recordRoutingTelemetry(db, seedRow({ buildId: 'build-1', stage: 'section-fanout', costUsd: 2, costEstimated: true }));
    recordRoutingTelemetry(db, seedRow({ buildId: 'build-1', stage: 'chat', costUsd: 100, costEstimated: false })); // different stage, same build
    recordRoutingTelemetry(db, seedRow({ buildId: 'build-2', stage: 'section-fanout', costUsd: 100, costEstimated: false })); // different build, same stage

    const snapshot = computeStageSpendUsd(db, 'build-1', 'section-fanout');
    expect(snapshot.totalCostUsd).toBeCloseTo(3, 10);
    expect(snapshot.rowCount).toBe(2);
    expect(snapshot.cost).toBe('mixed');
  });

  it('computeStageSpendUsd returns an empty snapshot for a (buildId, stage) pair with no rows yet', () => {
    const db = openDatabase(tempDir, { dataDir: tempDir });
    ensureRoutingTelemetryTable(db);
    recordRoutingTelemetry(db, seedRow({ buildId: 'build-1', stage: 'chat' }));
    expect(computeStageSpendUsd(db, 'build-1', 'never-seen-stage')).toEqual({ totalCostUsd: 0, rowCount: 0, cost: 'exact' });
  });
});
