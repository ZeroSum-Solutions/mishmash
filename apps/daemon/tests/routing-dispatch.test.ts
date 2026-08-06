// Dispatch-time routing integration (WR wave, P2 tranche, t9 -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.1 binding point + §5's P2
// phase gate). Covers apps/daemon/src/routing/dispatch.ts end to end:
//
//   - resolveDispatchRouting's four modes (routed / override / runtime-
//     default / blocked), including the fail-closed-stop and
//     denied-admission BLOCK paths (plan §3.2 L2: "never falls through").
//   - recordDispatchIntent's pre-spawn row shape (observed side null).
//   - reconcilePostRun's fill-in-observed + divergence + cooldown/
//     side-effect recording.
//   - computeRoutingRates's escalation/pass-rate + non-empty lane-meter
//     snapshot (the P2 "rates visible" gate, WR-routing.md CWR-P2-4).
//
// Real SQLite (mkdtemp'd per test, same pattern as routing-admission.test.ts
// and routing-reliability.test.ts) -- these functions are NOT pure (they
// call recordRoutingTelemetry/computeLaneMeters/computeCooldownStatuses
// internally), unlike decision.ts/admission.ts's table-driven pure cores.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RoutingPolicyDocument } from '@open-design/contracts';

import { closeDatabase, openDatabase } from '../src/db.js';
import {
  computeRoutingRates,
  recordDispatchIntent,
  reconcilePostRun,
  resolveDispatchRouting,
  type DispatchChatRequest,
  type DispatchProjectContext,
} from '../src/routing/dispatch.js';
import { ensureRoutingTelemetryTable, getRoutingTelemetryByRunId, recordRoutingTelemetry } from '../src/routing/telemetry.js';
import { ensureRoutingCooldownsTable, ensureRoutingRunSideEffectsTable, getCooldownRecord, getRunSideEffectKinds } from '../src/routing/reliability.js';

function fixturePolicy(overrides: Partial<RoutingPolicyDocument> = {}): RoutingPolicyDocument {
  return {
    policyVersion: 7,
    stageVocabulary: ['chat', 'section-fanout'],
    modelTable: [
      {
        match: { taskClass: 'test-class' },
        primary: {
          runtimeId: 'claude',
          model: 'claude-opus-5',
          effort: 'inherit',
          lane: 'claude-code-oauth',
          transport: 'subscription-oauth',
          modelFamily: 'anthropic',
        },
      },
    ],
    hardConstraints: [],
    laneChains: { 'claude-code-oauth': ['claude-code-oauth', 'nous'] },
    dataClassificationAllowlists: [
      { classification: 'public', allowedLanes: ['claude-code-oauth', 'nous'], failClosed: true },
    ],
    sonnetPriceRows: [],
    otherModelPriceRows: [{ model: 'claude-opus-5', inputPerMillion: 5, outputPerMillion: 25 }],
    budgetCeilings: {
      perStageEstimatedCostUsd: { chat: 1000, 'section-fanout': 1000 },
      perBuildCapUsd: 1000,
      perDayCapUsd: 1000,
      meteredKillSwitch: false,
    },
    ...overrides,
  };
}

const NOW = new Date('2026-08-05T12:00:00.000Z');

function chatRequest(overrides: Partial<DispatchChatRequest> = {}): DispatchChatRequest {
  return {
    runtimeDefault: { runtimeId: 'claude', model: 'claude-sonnet-5', lane: 'runtime-default' },
    ...overrides,
  };
}

function projectContext(overrides: Partial<DispatchProjectContext> = {}): DispatchProjectContext {
  return { projectId: 'proj-1', ...overrides };
}

describe('routing dispatch', () => {
  let tmpDir: string;
  let db: ReturnType<typeof openDatabase>;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'wr-dispatch-'));
    db = openDatabase(tmpDir);
    ensureRoutingTelemetryTable(db);
    ensureRoutingCooldownsTable(db);
    ensureRoutingRunSideEffectsTable(db);
  });

  afterEach(() => {
    closeDatabase();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('resolveDispatchRouting -- routed mode', () => {
    it('resolves the router by default when a taskClass is supplied, and the recordedIntent mirrors the decision', () => {
      const result = resolveDispatchRouting({
        db,
        policy: fixturePolicy(),
        chatRequest: chatRequest({ taskClass: 'test-class', sensitivityClass: 'public', stage: 'chat' }),
        projectContext: projectContext(),
        clock: NOW,
      });
      expect(result.mode).toBe('routed');
      expect(result.decision?.status).toBe('ok');
      expect(result.decision?.modelFlag).toBe('claude-opus-5');
      expect(result.decision?.lane).toBe('claude-code-oauth');
      expect(result.recordedIntent).toMatchObject({
        projectId: 'proj-1',
        stage: 'chat',
        routedModel: 'claude-opus-5',
        routedLane: 'claude-code-oauth',
        mode: 'routed',
        policyVersion: 7,
      });
    });
  });

  describe('resolveDispatchRouting -- override mode', () => {
    it('an explicit routingOverride wins unconditionally, bypassing the router, and records the would-have-been decision', () => {
      const result = resolveDispatchRouting({
        db,
        policy: fixturePolicy(),
        chatRequest: chatRequest({
          taskClass: 'test-class',
          sensitivityClass: 'public',
          stage: 'chat',
          routingOverride: { model: 'gpt-5.6-sol', lane: 'openrouter', reason: 'user asked for a second opinion' },
        }),
        projectContext: projectContext(),
        clock: NOW,
      });
      expect(result.mode).toBe('override');
      expect(result.decision?.status).toBe('ok');
      expect(result.decision?.modelFlag).toBe('gpt-5.6-sol');
      expect(result.decision?.lane).toBe('openrouter');
      expect(result.decision?.rationale).toContain('override');
      expect(result.decision?.rationale).toContain('user asked for a second opinion');
      // The router WOULD have picked the fixture's opus-5/claude-code-oauth
      // candidate for this exact taskClass -- the override result still
      // carries that comparison.
      expect(result.wouldHaveBeenDecision?.status).toBe('ok');
      expect(result.wouldHaveBeenDecision?.modelFlag).toBe('claude-opus-5');
      expect(result.recordedIntent).toMatchObject({
        routedModel: 'gpt-5.6-sol',
        routedLane: 'openrouter',
        mode: 'override',
      });
    });

    it('an override with no taskClass supplied still overrides, with a null would-have-been decision', () => {
      const result = resolveDispatchRouting({
        db,
        policy: fixturePolicy(),
        chatRequest: chatRequest({
          routingOverride: { model: 'gpt-5.6-sol', lane: 'openrouter', reason: '' },
        }),
        projectContext: projectContext(),
        clock: NOW,
      });
      expect(result.mode).toBe('override');
      expect(result.wouldHaveBeenDecision).toBeNull();
      expect(result.decision?.rationale).toContain('no reason given');
    });
  });

  describe('resolveDispatchRouting -- runtime-default mode (WR-routing.md Fallback B)', () => {
    it('falls back to the caller-supplied runtime default when no taskClass and no override are supplied', () => {
      const result = resolveDispatchRouting({
        db,
        policy: fixturePolicy(),
        chatRequest: chatRequest(),
        projectContext: projectContext(),
        clock: NOW,
      });
      expect(result.mode).toBe('runtime-default');
      expect(result.decision).toBeNull();
      expect(result.recordedIntent).toMatchObject({
        routedModel: 'claude-sonnet-5',
        routedLane: 'runtime-default',
        stage: 'chat',
        mode: 'runtime-default',
      });
    });
  });

  describe('resolveDispatchRouting -- blocked mode (plan §3.2 L2: never falls through)', () => {
    it('BLOCKS dispatch on a fail-closed-stop decision (no allowlist entry for the sensitivity class)', () => {
      const result = resolveDispatchRouting({
        db,
        policy: fixturePolicy({ dataClassificationAllowlists: [] }),
        chatRequest: chatRequest({ taskClass: 'test-class', sensitivityClass: 'client-confidential', stage: 'chat' }),
        projectContext: projectContext(),
        clock: NOW,
      });
      expect(result.mode).toBe('blocked');
      expect(result.blocked?.code).toBe('fail-closed-stop');
      expect(result.recordedIntent).toBeNull();
    });

    it('BLOCKS dispatch on a denied-admission decision (stage cost ceiling exceeded)', () => {
      const result = resolveDispatchRouting({
        db,
        policy: fixturePolicy({
          budgetCeilings: {
            perStageEstimatedCostUsd: { chat: 0 },
            perBuildCapUsd: 1000,
            perDayCapUsd: 1000,
            meteredKillSwitch: false,
          },
        }),
        chatRequest: chatRequest({
          taskClass: 'test-class',
          sensitivityClass: 'public',
          stage: 'chat',
          buildId: 'build-1',
          // A nonzero context estimate is required for a real denial here:
          // estimatedRunCostUsd's output-token estimate is `min(contextEstimateTokens,
          // bound)` (admission.ts's resolveOutputTokenEstimate), so a
          // context estimate of 0 always prices at $0 regardless of how low
          // the stage ceiling is -- there would be nothing to deny.
          contextEstimateTokens: 100_000,
        }),
        projectContext: projectContext({ buildId: 'build-1' }),
        clock: NOW,
      });
      expect(result.mode).toBe('blocked');
      expect(result.blocked?.code).toBe('denied-admission');
      expect(result.recordedIntent).toBeNull();
    });

    it('BLOCKS dispatch on a structurally-invalid decision (unknown stage)', () => {
      const result = resolveDispatchRouting({
        db,
        policy: fixturePolicy(),
        chatRequest: chatRequest({ taskClass: 'test-class', sensitivityClass: 'public', stage: 'not-a-real-stage' }),
        projectContext: projectContext(),
        clock: NOW,
      });
      expect(result.mode).toBe('blocked');
      expect(result.blocked?.code).toBe('routing-error');
      expect(result.recordedIntent).toBeNull();
    });
  });

  describe('recordDispatchIntent', () => {
    it('writes the pre-spawn telemetry row with the observed side left null', () => {
      const result = resolveDispatchRouting({
        db,
        policy: fixturePolicy(),
        chatRequest: chatRequest({ taskClass: 'test-class', sensitivityClass: 'public', stage: 'chat' }),
        projectContext: projectContext(),
        clock: NOW,
      });
      expect(result.recordedIntent).not.toBeNull();
      recordDispatchIntent(db, 'run-1', 0, result.recordedIntent!);
      const row = getRoutingTelemetryByRunId(db, 'run-1', 0);
      expect(row).not.toBeNull();
      expect(row).toMatchObject({
        runId: 'run-1',
        attempt: 0,
        routedModel: 'claude-opus-5',
        routedLane: 'claude-code-oauth',
        observedModel: null,
        observedLane: null,
        escalated: false,
      });
    });
  });

  describe('reconcilePostRun', () => {
    it('fills the observed side and reports a match when observed agrees with routed', () => {
      recordDispatchIntent(
        db,
        'run-2',
        0,
        {
          projectId: 'proj-1',
          buildId: null,
          stage: 'chat',
          templateId: null,
          designSystem: null,
          routedModel: 'claude-opus-5',
          routedLane: 'claude-code-oauth',
          sensitivityClass: 'public',
          policyVersion: 7,
          mode: 'routed',
        },
      );
      const result = reconcilePostRun(db, 'run-2', 0, {
        observedModel: 'claude-opus-5',
        observedLane: 'claude-code-oauth',
        tokens: { input: 100, output: 50, cacheReadInput: 0 },
        costUsd: 0.01,
        now: NOW,
      });
      expect(result.reconciliation).toMatchObject({ status: 'match', divergent: false });
      const row = getRoutingTelemetryByRunId(db, 'run-2', 0);
      expect(row?.observedModel).toBe('claude-opus-5');
      expect(row?.tokens.input).toBe(100);
    });

    it('reports model-divergence when the observed model differs from routed', () => {
      recordDispatchIntent(
        db,
        'run-3',
        0,
        {
          projectId: 'proj-1',
          buildId: null,
          stage: 'chat',
          templateId: null,
          designSystem: null,
          routedModel: 'claude-opus-5',
          routedLane: 'claude-code-oauth',
          sensitivityClass: 'public',
          policyVersion: 7,
          mode: 'routed',
        },
      );
      const result = reconcilePostRun(db, 'run-3', 0, {
        observedModel: 'claude-sonnet-5',
        observedLane: 'claude-code-oauth',
        now: NOW,
      });
      expect(result.reconciliation?.status).toBe('model-divergence');
      expect(result.reconciliation?.divergent).toBe(true);
    });

    it('returns a null reconciliation (no throw) when no pre-spawn intent row exists', () => {
      const result = reconcilePostRun(db, 'never-recorded', 0, { observedModel: 'x', observedLane: 'y', now: NOW });
      expect(result.reconciliation).toBeNull();
      expect(result.recordedFailure).toBe(false);
      expect(result.markedSideEffectKinds).toEqual([]);
    });

    it('records an observed rate_limit failure into the runtime/lane cooldown scopes', () => {
      recordDispatchIntent(
        db,
        'run-4',
        0,
        {
          projectId: 'proj-1',
          buildId: null,
          stage: 'chat',
          templateId: null,
          designSystem: null,
          routedModel: 'claude-opus-5',
          routedLane: 'claude-code-oauth',
          sensitivityClass: 'public',
          policyVersion: 7,
          mode: 'routed',
        },
      );
      const result = reconcilePostRun(db, 'run-4', 0, {
        observedModel: null,
        observedLane: null,
        runtimeId: 'claude',
        failureCategory: 'rate_limit',
        now: NOW,
      });
      expect(result.recordedFailure).toBe(true);
      expect(getCooldownRecord(db, 'runtime', 'claude')?.consecutiveFailures).toBe(1);
      expect(getCooldownRecord(db, 'lane', 'claude-code-oauth')?.consecutiveFailures).toBe(1);
    });

    it('does NOT record a cooldown failure for a non-reliability failure category (e.g. auth)', () => {
      recordDispatchIntent(
        db,
        'run-5',
        0,
        {
          projectId: 'proj-1',
          buildId: null,
          stage: 'chat',
          templateId: null,
          designSystem: null,
          routedModel: 'claude-opus-5',
          routedLane: 'claude-code-oauth',
          sensitivityClass: 'public',
          policyVersion: 7,
          mode: 'routed',
        },
      );
      const result = reconcilePostRun(db, 'run-5', 0, {
        observedModel: null,
        observedLane: null,
        runtimeId: 'claude',
        failureCategory: 'auth',
        now: NOW,
      });
      expect(result.recordedFailure).toBe(false);
      expect(getCooldownRecord(db, 'runtime', 'claude')).toBeNull();
    });

    it('marks the run non-redispatchable when observed side effects are supplied', () => {
      recordDispatchIntent(
        db,
        'run-6',
        0,
        {
          projectId: 'proj-1',
          buildId: null,
          stage: 'chat',
          templateId: null,
          designSystem: null,
          routedModel: 'claude-opus-5',
          routedLane: 'claude-code-oauth',
          sensitivityClass: 'public',
          policyVersion: 7,
          mode: 'routed',
        },
      );
      const result = reconcilePostRun(db, 'run-6', 0, {
        observedModel: 'claude-opus-5',
        observedLane: 'claude-code-oauth',
        sideEffectKinds: ['git-push'],
        now: NOW,
      });
      expect(result.markedSideEffectKinds).toEqual(['git-push']);
      expect(getRunSideEffectKinds(db, 'run-6')).toEqual(['git-push']);
    });
  });

  describe('computeRoutingRates', () => {
    it('seeds every policy-known lane with an empty meter even with zero telemetry rows (non-empty laneMeters)', () => {
      const rates = computeRoutingRates(db);
      expect(rates.totalRuns).toBe(0);
      expect(rates.escalationRate).toBe(0);
      expect(rates.passRate).toBe(0);
      expect(Object.keys(rates.laneMeters).length).toBeGreaterThan(0);
      expect(rates.laneMeters['claude-code-oauth']).toBeDefined();
      expect(rates.byStage).toEqual([]);
    });

    it('computes overall + per-stage escalation/pass rates from seeded telemetry', () => {
      const nowIso = NOW.toISOString();
      recordRoutingTelemetry(db, {
        runId: 'r1',
        attempt: 0,
        projectId: 'p1',
        buildId: null,
        stage: 'chat',
        templateId: null,
        designSystem: null,
        routedModel: 'claude-opus-5',
        observedModel: 'claude-opus-5',
        routedLane: 'claude-code-oauth',
        observedLane: 'claude-code-oauth',
        tokens: { input: 10, output: 10, cacheReadInput: 0 },
        cacheHits: 0,
        latencyMs: 10,
        costUsd: 0.01,
        costEstimated: true,
        gateOutcomes: { 'ts-compile': 'pass' },
        escalated: false,
        policyVersion: 7,
        createdAt: nowIso,
        recordedAt: nowIso,
      });
      recordRoutingTelemetry(db, {
        runId: 'r2',
        attempt: 0,
        projectId: 'p1',
        buildId: null,
        stage: 'chat',
        templateId: null,
        designSystem: null,
        routedModel: 'claude-opus-5',
        observedModel: 'claude-opus-5',
        routedLane: 'claude-code-oauth',
        observedLane: 'claude-code-oauth',
        tokens: { input: 10, output: 10, cacheReadInput: 0 },
        cacheHits: 0,
        latencyMs: 10,
        costUsd: 0.01,
        costEstimated: true,
        gateOutcomes: { 'ts-compile': 'fail' },
        escalated: true,
        policyVersion: 7,
        createdAt: nowIso,
        recordedAt: nowIso,
      });
      const rates = computeRoutingRates(db);
      expect(rates.totalRuns).toBe(2);
      expect(rates.escalationRate).toBeCloseTo(0.5, 10);
      expect(rates.passRate).toBeCloseTo(0.5, 10);
      expect(rates.byStage).toHaveLength(1);
      expect(rates.byStage[0]).toMatchObject({ stage: 'chat', runs: 2, escalationRate: 0.5, passRate: 0.5 });
      expect(rates.laneMeters['claude-code-oauth']?.runsRouted).toBe(2);
    });
  });
});
