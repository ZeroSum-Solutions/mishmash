// Dispatch-time routing integration (WR wave, P2 tranche, t9 -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.1 binding point + §5's P2
// phase gate). Fix-round coverage (Sol review) added alongside the original:
//
//   - resolveDispatchRouting's four modes (routed / override / runtime-
//     default / blocked), including the fail-closed-stop and
//     denied-admission BLOCK paths (plan §3.2 L2: "never falls through").
//   - HIGH-2: an override resolves into a vetted policy candidate and is run
//     through the SAME §15 hard-constraint / data-classification / admission
//     filters a routed decision uses -- a constraint-violating override
//     blocks, naming the violated rule; a valid override applies.
//   - HIGH-1: a routed/override decision naming a DIFFERENT runtime than the
//     caller actually selected is blocked, never silently ignored.
//   - MED-8: a candidate carrying dispatchValidation.slugRecheckAtDispatch
//     gets a dispatch-time slug-format recheck (documented honesty boundary
//     -- format, not a live provider probe).
//   - recordDispatchIntent's pre-spawn row shape (observed side null).
//   - reconcilePostRun's fill-in-observed + divergence + cooldown/
//     side-effect recording, gated on an explicit `terminalOutcome`
//     (MED-6): 'succeeded' clears a cooldown, 'failed' (+ a recordable
//     category) records one, 'canceled'/'unknown' touch neither.
//   - computeRoutingRates's escalation/pass-rate + non-empty lane-meter
//     snapshot (the P2 "rates visible" gate, WR-routing.md CWR-P2-4), with
//     synthetic gate-cascade probe rows kept OUT of the top-level dispatch
//     numbers (MED-7).
//
// Real SQLite (mkdtemp'd per test, same pattern as routing-admission.test.ts
// and routing-reliability.test.ts) -- these functions are NOT pure (they
// call recordRoutingTelemetry/computeLaneMeters/computeCooldownStatuses
// internally), unlike decision.ts/admission.ts's table-driven pure cores.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RoutingCandidate, RoutingPolicyDocument } from '@open-design/contracts';

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

const VALID_OVERRIDE_CANDIDATE: RoutingCandidate = {
  runtimeId: 'claude',
  model: 'gpt-5.6-sol',
  effort: 'inherit',
  lane: 'openrouter',
  transport: 'metered-api',
  modelFamily: 'openai',
};

const ILLEGAL_ANTHROPIC_ON_NOUS_CANDIDATE: RoutingCandidate = {
  runtimeId: 'claude',
  model: 'claude-illegal-on-nous',
  effort: 'inherit',
  lane: 'nous',
  transport: 'prepaid',
  modelFamily: 'anthropic',
};

const CROSS_RUNTIME_CANDIDATE: RoutingCandidate = {
  runtimeId: 'codex',
  model: 'gpt-5-codex',
  effort: 'inherit',
  lane: 'codex-oauth',
  transport: 'subscription-oauth',
  modelFamily: 'openai',
};

const SLUG_RECHECK_MALFORMED_CANDIDATE: RoutingCandidate = {
  runtimeId: 'claude',
  model: 'bad model with spaces',
  effort: 'inherit',
  lane: 'openrouter',
  transport: 'metered-api',
  modelFamily: 'openai',
  dispatchValidation: { slugRecheckAtDispatch: true },
};

const SLUG_RECHECK_WELLFORMED_CANDIDATE: RoutingCandidate = {
  runtimeId: 'claude',
  model: 'deepseek-v4-flash',
  effort: 'inherit',
  lane: 'deepseek-direct',
  transport: 'metered-api',
  modelFamily: 'deepseek',
  dispatchValidation: { slugRecheckAtDispatch: true },
};

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
      // Non-primary rows exist purely so findCandidateByModelAndLane (an
      // ANY-row lookup, per its own doc comment) can resolve override
      // (model, lane) pairs the tests below exercise -- their `match`
      // taskClass is irrelevant to override resolution.
      { match: { taskClass: 'override-valid' }, primary: VALID_OVERRIDE_CANDIDATE },
      { match: { taskClass: 'override-illegal' }, primary: ILLEGAL_ANTHROPIC_ON_NOUS_CANDIDATE },
      { match: { taskClass: 'override-cross-runtime' }, primary: CROSS_RUNTIME_CANDIDATE },
      { match: { taskClass: 'override-slug-malformed' }, primary: SLUG_RECHECK_MALFORMED_CANDIDATE },
      { match: { taskClass: 'override-slug-wellformed' }, primary: SLUG_RECHECK_WELLFORMED_CANDIDATE },
    ],
    hardConstraints: [
      {
        id: 'no-anthropic-on-nous',
        description: 'No Anthropic model may dispatch through the prepaid Nous Portal lane.',
        modelFamily: 'anthropic',
        forbiddenTransports: ['prepaid'],
      },
    ],
    laneChains: {
      'claude-code-oauth': ['claude-code-oauth', 'nous'],
      'codex-oauth': ['codex-oauth'],
    },
    dataClassificationAllowlists: [
      { classification: 'public', allowedLanes: ['claude-code-oauth', 'nous', 'openrouter', 'codex-oauth', 'deepseek-direct'], failClosed: true },
    ],
    sonnetPriceRows: [],
    otherModelPriceRows: [
      { model: 'claude-opus-5', inputPerMillion: 5, outputPerMillion: 25 },
      { model: 'gpt-5.6-sol', inputPerMillion: 5, outputPerMillion: 30 },
      { model: 'gpt-5-codex', inputPerMillion: 5, outputPerMillion: 30 },
      { model: 'bad model with spaces', inputPerMillion: 5, outputPerMillion: 30 },
      { model: 'deepseek-v4-flash', inputPerMillion: 0.14, outputPerMillion: 0.28 },
    ],
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

    it('HIGH-1: BLOCKS a routed decision naming a different runtime than the caller already selected', () => {
      // §15 program assignments pin a candidate's runtimeId directly; here
      // we simulate the same shape by matching a modelTable row whose
      // candidate belongs to a runtime other than chatRequest's own
      // ('claude'). The 'override-cross-runtime' row's primary is
      // CROSS_RUNTIME_CANDIDATE (runtimeId 'codex').
      const result = resolveDispatchRouting({
        db,
        policy: fixturePolicy(),
        chatRequest: chatRequest({ taskClass: 'override-cross-runtime', sensitivityClass: 'public', stage: 'chat' }),
        projectContext: projectContext(),
        clock: NOW,
      });
      expect(result.mode).toBe('blocked');
      expect(result.blocked?.code).toBe('routing-error');
      expect(result.blocked?.message).toContain('codex');
      expect(result.blocked?.message).toContain('claude');
      expect(result.recordedIntent).toBeNull();
    });

    it('MED-8: BLOCKS a routed decision whose slugRecheckAtDispatch candidate fails the slug-format recheck', () => {
      const result = resolveDispatchRouting({
        db,
        policy: fixturePolicy(),
        chatRequest: chatRequest({ taskClass: 'override-slug-malformed', sensitivityClass: 'public', stage: 'chat' }),
        projectContext: projectContext(),
        clock: NOW,
      });
      expect(result.mode).toBe('blocked');
      expect(result.blocked?.code).toBe('routing-error');
      expect(result.blocked?.message).toContain('slug');
      expect(result.recordedIntent).toBeNull();
    });

    it('MED-8: a well-formed slugRecheckAtDispatch candidate passes the recheck and routes normally', () => {
      const result = resolveDispatchRouting({
        db,
        policy: fixturePolicy(),
        chatRequest: chatRequest({ taskClass: 'override-slug-wellformed', sensitivityClass: 'public', stage: 'chat' }),
        projectContext: projectContext(),
        clock: NOW,
      });
      expect(result.mode).toBe('routed');
      expect(result.decision?.modelFlag).toBe('deepseek-v4-flash');
    });
  });

  describe('resolveDispatchRouting -- override mode (HIGH-2: vetted through §15/allowlist/admission)', () => {
    it('an explicit routingOverride that resolves to a vetted candidate applies, bypassing the ROUTER but not the RULES', () => {
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
      expect(result.decision?.rationale).toContain('vetted');
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

    it('an override with no taskClass supplied still overrides (once vetted), with a null would-have-been decision', () => {
      const result = resolveDispatchRouting({
        db,
        policy: fixturePolicy(),
        chatRequest: chatRequest({
          sensitivityClass: 'public',
          routingOverride: { model: 'gpt-5.6-sol', lane: 'openrouter', reason: '' },
        }),
        projectContext: projectContext(),
        clock: NOW,
      });
      expect(result.mode).toBe('override');
      expect(result.wouldHaveBeenDecision).toBeNull();
      expect(result.decision?.rationale).toContain('vetted');
    });

    it('HIGH-2: BLOCKS an override naming a (model, lane) pair this policy has never vetted anywhere', () => {
      const result = resolveDispatchRouting({
        db,
        policy: fixturePolicy(),
        chatRequest: chatRequest({
          routingOverride: { model: 'totally-unknown-model', lane: 'openrouter', reason: 'test' },
        }),
        projectContext: projectContext(),
        clock: NOW,
      });
      expect(result.mode).toBe('blocked');
      expect(result.blocked?.code).toBe('routing-error');
      expect(result.blocked?.message).toContain('not a recognized');
      expect(result.recordedIntent).toBeNull();
    });

    it('HIGH-2: BLOCKS a constraint-violating override (anthropic on the prepaid Nous lane), naming the violated rule', () => {
      const result = resolveDispatchRouting({
        db,
        policy: fixturePolicy(),
        chatRequest: chatRequest({
          sensitivityClass: 'public',
          routingOverride: { model: 'claude-illegal-on-nous', lane: 'nous', reason: 'test' },
        }),
        projectContext: projectContext(),
        clock: NOW,
      });
      expect(result.mode).toBe('blocked');
      expect(result.blocked?.code).toBe('fail-closed-stop');
      expect(result.blocked?.message).toContain('no-anthropic-on-nous');
      expect(result.recordedIntent).toBeNull();
    });

    it('HIGH-2: BLOCKS an over-budget override the same way any candidate is denied by admission control', () => {
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
          sensitivityClass: 'public',
          buildId: 'build-1',
          contextEstimateTokens: 100_000,
          routingOverride: { model: 'gpt-5.6-sol', lane: 'openrouter', reason: 'test' },
        }),
        projectContext: projectContext({ buildId: 'build-1' }),
        clock: NOW,
      });
      expect(result.mode).toBe('blocked');
      expect(result.blocked?.code).toBe('denied-admission');
      expect(result.recordedIntent).toBeNull();
    });

    it('HIGH-1: BLOCKS an override resolving to a different runtime than the caller already selected', () => {
      const result = resolveDispatchRouting({
        db,
        policy: fixturePolicy(),
        chatRequest: chatRequest({
          sensitivityClass: 'public',
          routingOverride: { model: 'gpt-5-codex', lane: 'codex-oauth', reason: 'test' },
        }),
        projectContext: projectContext(),
        clock: NOW,
      });
      expect(result.mode).toBe('blocked');
      expect(result.blocked?.code).toBe('routing-error');
      expect(result.blocked?.message).toContain('codex');
      expect(result.recordedIntent).toBeNull();
    });

    it('MED-8: BLOCKS an override whose slugRecheckAtDispatch candidate fails the slug-format recheck', () => {
      const result = resolveDispatchRouting({
        db,
        policy: fixturePolicy(),
        chatRequest: chatRequest({
          sensitivityClass: 'public',
          routingOverride: { model: 'bad model with spaces', lane: 'openrouter', reason: 'test' },
        }),
        projectContext: projectContext(),
        clock: NOW,
      });
      expect(result.mode).toBe('blocked');
      expect(result.blocked?.code).toBe('routing-error');
      expect(result.blocked?.message).toContain('slug');
      expect(result.recordedIntent).toBeNull();
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
    function seedIntent(runId: string): void {
      recordDispatchIntent(db, runId, 0, {
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
      });
    }

    it('fills the observed side and reports a match when observed agrees with routed', () => {
      seedIntent('run-2');
      const result = reconcilePostRun(db, 'run-2', 0, {
        observedModel: 'claude-opus-5',
        observedLane: 'claude-code-oauth',
        tokens: { input: 100, output: 50, cacheReadInput: 0 },
        costUsd: 0.01,
        terminalOutcome: 'succeeded',
        now: NOW,
      });
      expect(result.reconciliation).toMatchObject({ status: 'match', divergent: false });
      const row = getRoutingTelemetryByRunId(db, 'run-2', 0);
      expect(row?.observedModel).toBe('claude-opus-5');
      expect(row?.tokens.input).toBe(100);
    });

    it('reports model-divergence when the observed model differs from routed', () => {
      seedIntent('run-3');
      const result = reconcilePostRun(db, 'run-3', 0, {
        observedModel: 'claude-sonnet-5',
        observedLane: 'claude-code-oauth',
        terminalOutcome: 'succeeded',
        now: NOW,
      });
      expect(result.reconciliation?.status).toBe('model-divergence');
      expect(result.reconciliation?.divergent).toBe(true);
    });

    it('returns a null reconciliation (no throw) when no pre-spawn intent row exists', () => {
      const result = reconcilePostRun(db, 'never-recorded', 0, {
        observedModel: 'x',
        observedLane: 'y',
        terminalOutcome: 'succeeded',
        now: NOW,
      });
      expect(result.reconciliation).toBeNull();
      expect(result.recordedFailure).toBe(false);
      expect(result.markedSideEffectKinds).toEqual([]);
    });

    it("records an observed rate_limit failure into the runtime/lane cooldown scopes when terminalOutcome is 'failed'", () => {
      seedIntent('run-4');
      const result = reconcilePostRun(db, 'run-4', 0, {
        observedModel: null,
        observedLane: null,
        runtimeId: 'claude',
        terminalOutcome: 'failed',
        failureCategory: 'rate_limit',
        now: NOW,
      });
      expect(result.recordedFailure).toBe(true);
      expect(getCooldownRecord(db, 'runtime', 'claude')?.consecutiveFailures).toBe(1);
      expect(getCooldownRecord(db, 'lane', 'claude-code-oauth')?.consecutiveFailures).toBe(1);
    });

    it('does NOT record a cooldown failure for a non-reliability failure category (e.g. auth)', () => {
      seedIntent('run-5');
      const result = reconcilePostRun(db, 'run-5', 0, {
        observedModel: null,
        observedLane: null,
        runtimeId: 'claude',
        terminalOutcome: 'failed',
        failureCategory: 'auth',
        now: NOW,
      });
      expect(result.recordedFailure).toBe(false);
      expect(getCooldownRecord(db, 'runtime', 'claude')).toBeNull();
    });

    it('marks the run non-redispatchable when observed side effects are supplied', () => {
      seedIntent('run-6');
      const result = reconcilePostRun(db, 'run-6', 0, {
        observedModel: 'claude-opus-5',
        observedLane: 'claude-code-oauth',
        sideEffectKinds: ['git-push'],
        terminalOutcome: 'succeeded',
        now: NOW,
      });
      expect(result.markedSideEffectKinds).toEqual(['git-push']);
      expect(getRunSideEffectKinds(db, 'run-6')).toEqual(['git-push']);
    });

    // MED-6: terminalOutcome gates the cooldown side effect explicitly --
    // a cancellation or an unclassified terminal state must never read as a
    // clean success (which would wrongly clear an earned cooldown) nor as a
    // recordable failure (there is no reliability signal to draw from
    // either).
    describe('MED-6 -- terminalOutcome gates cooldown recording/clearing explicitly', () => {
      it("'canceled' touches neither recordObservedFailure nor clearOnSuccess", () => {
        seedIntent('run-canceled');
        const result = reconcilePostRun(db, 'run-canceled', 0, {
          observedModel: null,
          observedLane: null,
          runtimeId: 'claude',
          terminalOutcome: 'canceled',
          now: NOW,
        });
        expect(result.recordedFailure).toBe(false);
        expect(result.clearedCooldown).toBe(false);
        expect(getCooldownRecord(db, 'runtime', 'claude')).toBeNull();
      });

      it("'unknown' touches neither recordObservedFailure nor clearOnSuccess", () => {
        seedIntent('run-unknown');
        const result = reconcilePostRun(db, 'run-unknown', 0, {
          observedModel: null,
          observedLane: null,
          runtimeId: 'claude',
          terminalOutcome: 'unknown',
          now: NOW,
        });
        expect(result.recordedFailure).toBe(false);
        expect(result.clearedCooldown).toBe(false);
        expect(getCooldownRecord(db, 'runtime', 'claude')).toBeNull();
      });

      it("a genuine 'succeeded' outcome clears a cooldown a prior 'failed' outcome recorded (order preserved)", () => {
        seedIntent('run-recover-1');
        const failResult = reconcilePostRun(db, 'run-recover-1', 0, {
          observedModel: null,
          observedLane: null,
          runtimeId: 'claude',
          terminalOutcome: 'failed',
          failureCategory: 'rate_limit',
          now: NOW,
        });
        expect(failResult.recordedFailure).toBe(true);
        expect(getCooldownRecord(db, 'runtime', 'claude')?.consecutiveFailures).toBe(1);

        seedIntent('run-recover-2');
        const successResult = reconcilePostRun(db, 'run-recover-2', 0, {
          observedModel: 'claude-opus-5',
          observedLane: 'claude-code-oauth',
          runtimeId: 'claude',
          terminalOutcome: 'succeeded',
          now: new Date(NOW.getTime() + 1000),
        });
        expect(successResult.clearedCooldown).toBe(true);
        expect(getCooldownRecord(db, 'runtime', 'claude')?.consecutiveFailures).toBe(0);
      });
    });
  });

  describe('computeRoutingRates', () => {
    it('seeds every policy-known lane with an empty meter even with zero telemetry rows (non-empty laneMeters)', () => {
      const rates = computeRoutingRates(db);
      expect(rates.totalRuns).toBe(0);
      expect(rates.escalationRate).toBe(0);
      expect(rates.passRate).toBe(0);
      expect(rates.gateCascadeRuns).toBe(0);
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
      expect(rates.gateCascadeRuns).toBe(0);
      expect(rates.byStage).toHaveLength(1);
      expect(rates.byStage[0]).toMatchObject({ stage: 'chat', runs: 2, escalationRate: 0.5, passRate: 0.5 });
      expect(rates.laneMeters['claude-code-oauth']?.runsRouted).toBe(2);
    });

    // MED-7: a synthetic standalone gate-cascade probe row (stage
    // 'gates-run', the sentinel POST /api/routing/gates/run writes when no
    // real dispatch backs the call) must never be summed into the
    // top-level dispatch escalation/pass rate -- it gets its own rollup.
    it("MED-7: keeps synthetic 'gates-run' probe rows OUT of the top-level dispatch escalation/pass rate", () => {
      const nowIso = NOW.toISOString();
      recordRoutingTelemetry(db, {
        runId: 'real-dispatch',
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
        runId: 'gates-run-probe',
        attempt: 0,
        projectId: 'gates-run',
        buildId: null,
        stage: 'gates-run',
        templateId: null,
        designSystem: null,
        routedModel: 'none',
        observedModel: null,
        routedLane: 'none',
        observedLane: null,
        tokens: { input: 0, output: 0, cacheReadInput: 0 },
        cacheHits: 0,
        latencyMs: 0,
        costUsd: 0,
        costEstimated: true,
        gateOutcomes: { axe: 'fail' },
        escalated: true,
        policyVersion: 7,
        createdAt: nowIso,
        recordedAt: nowIso,
      });
      const rates = computeRoutingRates(db);
      // Only the real dispatch row counts toward the top-level numbers.
      expect(rates.totalRuns).toBe(1);
      expect(rates.escalationRate).toBe(0);
      expect(rates.passRate).toBe(1);
      // The gate-cascade probe row gets its own, separate rollup.
      expect(rates.gateCascadeRuns).toBe(1);
      expect(rates.gateCascadeEscalationRate).toBe(1);
      expect(rates.gateCascadePassRate).toBe(0);
      // Per-stage breakdown still reports both stages independently.
      expect(rates.byStage.find((s) => s.stage === 'gates-run')).toMatchObject({ runs: 1, escalationRate: 1 });
      expect(rates.byStage.find((s) => s.stage === 'chat')).toMatchObject({ runs: 1, escalationRate: 0 });
    });
  });
});
