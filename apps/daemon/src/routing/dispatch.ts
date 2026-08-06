// Dispatch-time routing integration (WR wave, P2 tranche, t9 -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.1 binding point + §5's P2
// phase gate).
//
// This is the seam a chat dispatch calls BEFORE spawn (plan §3.1: "The
// router selects (runtime, model flag, effort, lane, prompt composition)
// before spawn"). Four responsibilities, matching this task's own brief:
//
//   1. `resolveDispatchRouting` -- decide whether the router (`decideRouting`,
//      t5), the caller's explicit override, or the runtime's own default
//      resolves the model/lane for this dispatch, per
//      docs/plans/waves/WR-routing.md's "Routing-key fallback (normative)"
//      table. A fail-closed/denied-admission/structurally-invalid decision
//      BLOCKS dispatch outright (plan §3.2 L2: "it never falls through") --
//      this module returns a typed, user-surfaceable error for that case
//      rather than silently degrading to a runtime default.
//   2. `recordDispatchIntent` -- writes the PRE-SPAWN telemetry row (routed
//      side only; observed side stays null until reconciliation).
//   3. `reconcilePostRun` -- fills the observed side once the run reports
//      back, computes routed-vs-observed divergence (t4's
//      `reconcileRoutedVsObserved`), and feeds observed failures into t7's
//      reliability cooldowns / non-redispatchable side-effect marking.
//   4. `computeRoutingRates` -- the escalation-rate + gate-pass-rate (by
//      stage/template) + per-lane-meter snapshot the P2 gate requires to be
//      "visible" (plan §5), surfaced via GET /api/routing/rates and
//      `od route [rates] --json` (routes/routing.ts, cli.ts).
//
// Governance note (t9, see this task's report for the exact
// governance-amendment entry): `packages/contracts/src/api/chat.ts`
// (`ChatRequest`) is OUTSIDE this wave's lease -- docs/plans/waves/
// WR-routing.md's "Lease" section grants only routing-policy.ts/
// routing-decision.ts/routing-telemetry.ts/index.ts under
// packages/contracts/src/api -- so a `routingOverride` field cannot be
// declared as first-class DTO surface on `ChatRequest` yet. This module's
// `DispatchChatRequest` is therefore its OWN shape (not `ChatRequest`
// itself); apps/daemon/src/server.ts's wiring reads `routingOverride`
// permissively off the raw chat body it already has in hand. The same gap
// means a real /api/chat request today carries no `templateId`/`buildClass`/
// `taskClass` (ChatRequest has no such fields), so 'routed' mode is honestly
// unreachable through the live chat path until a future tranche adds them --
// every real chat dispatch resolves 'runtime-default' (WR-routing.md
// Fallback B) or 'override' (when the caller supplies one), which is the
// CORRECT, honest behavior per the routing-key fallback table, not a bug.
import type Database from 'better-sqlite3';
import {
  emptyLaneMeter,
  type LaneMeter,
  type RoutingDataClassification,
  type RoutingDecision,
  type RoutingKey,
  type RoutingPolicyDocument,
  type RoutingRatesByStage,
  type RoutingRatesResponse,
  type RoutingSideEffectKind,
  type StoredRoutingTelemetryRow,
  type TrackingRunFailureCategory,
} from '@open-design/contracts';
import { decideRouting, estimatePromptTokens } from './decision.js';
import { loadRoutingPolicy } from './policy.js';
import {
  clearOnSuccess,
  markRunSideEffects,
  recordObservedFailure,
  resolveCooldownConfig,
  computeCooldownStatuses,
} from './reliability.js';
import {
  computeBuildSpendUsd,
  computeDaySpendUsd,
  computeLaneMeters,
  computeStageAggregates,
  computeStageSpendUsd,
  ensureRoutingTelemetryTable,
  getRoutingTelemetryByRunId,
  reconcileRoutedVsObserved,
  recordRoutingTelemetry,
  type RoutingReconciliation,
} from './telemetry.js';

// ---------------------------------------------------------------------------
// resolveDispatchRouting
// ---------------------------------------------------------------------------

export interface DispatchRoutingOverride {
  model: string;
  lane: string;
  reason: string;
}

/** What the caller would spawn absent any routing decision -- the
 * WR-routing.md Fallback B "runtime default" itself. `lane` has no natural
 * source outside the routing policy for a plain runtime default (no §2/§15
 * candidate was ever matched), so callers pass the sentinel lane name
 * `'runtime-default'` (see server.ts's wiring) rather than fabricating a
 * transport this module has no way to verify. */
export interface DispatchRuntimeDefault {
  runtimeId: string;
  model: string;
  lane: string;
}

export interface DispatchChatRequest {
  /** Explicit user/caller override -- when present (and both `model` and
   * `lane` are non-empty), it wins unconditionally: this is a deliberate
   * user choice, not a candidate for admission/fail-closed filtering. */
  routingOverride?: DispatchRoutingOverride | null;
  templateId?: string | null;
  buildClass?: string | null;
  /** Defaults to `'chat'` (WR-routing.md Fallback B's stage) when omitted. */
  stage?: string | null;
  /** The §2/§15 identity this dispatch matches. `null` means "no §2/§15
   * identity at all" (general chat, WR-routing.md Fallback B) -- this is
   * the ONE field that decides 'routed' vs 'runtime-default' below; every
   * other field only shapes what a 'routed' decision resolves to. */
  taskClass?: string | null;
  /** Fail-closed default applied when omitted: `'client-confidential'`
   * (plan §3.2 L2 -- an unresolved sensitivity class must never default to
   * the LEAST restrictive value), mirroring routes/routing.ts's own
   * preview-endpoint default. */
  sensitivityClass?: RoutingDataClassification | null;
  contextEstimateTokens?: number | null;
  /** Used to derive `contextEstimateTokens` via `estimatePromptTokens` only
   * when `contextEstimateTokens` itself is omitted. */
  promptText?: string | null;
  buildId?: string | null;
  designSystemId?: string | null;
  runtimeDefault: DispatchRuntimeDefault;
}

export interface DispatchProjectContext {
  projectId: string;
  buildId?: string | null;
}

export type DispatchMode = 'routed' | 'override' | 'runtime-default' | 'blocked';

/** The pre-spawn telemetry row's routed-side content -- everything
 * `recordDispatchIntent` needs to write a row via
 * `apps/daemon/src/routing/telemetry.ts`'s `recordRoutingTelemetry`. Never
 * populated for `mode: 'blocked'` -- a blocked dispatch never spawns, so
 * there is nothing to record as routed (recording it would misrepresent a
 * refusal as a routing decision). */
export interface RecordedDispatchIntent {
  projectId: string;
  buildId: string | null;
  stage: string;
  templateId: string | null;
  designSystem: string | null;
  routedModel: string;
  routedLane: string;
  sensitivityClass: RoutingDataClassification;
  policyVersion: number;
  mode: Exclude<DispatchMode, 'blocked'>;
}

/** Typed, user-surfaceable reason a dispatch was blocked (plan §3.2 L2:
 * "it never falls through"). `'routing-error'` is this module's own
 * extension beyond the two statuses the task brief names explicitly
 * (`fail-closed-stop`/`denied-admission`) -- a structurally invalid decision
 * (`RoutingDecision#status === 'error'`, e.g. an unknown stage or no
 * matching §2/§15 row) resolves to `runtimeId: 'none'` with nothing spawnable
 * either, so it is blocked for the identical reason: there is no vetted
 * candidate to launch. */
export interface DispatchBlockedError {
  code: 'fail-closed-stop' | 'denied-admission' | 'routing-error';
  message: string;
  decision: RoutingDecision;
}

export interface ResolveDispatchRoutingResult {
  mode: DispatchMode;
  decision: RoutingDecision | null;
  /** 'override' mode only: what the router would have decided had the
   * caller not overridden it. `null` when no `taskClass` was supplied (there
   * is nothing to compare the override against) or `mode !== 'override'`. */
  wouldHaveBeenDecision?: RoutingDecision | null;
  recordedIntent: RecordedDispatchIntent | null;
  blocked?: DispatchBlockedError;
}

export interface ResolveDispatchRoutingInput {
  db: Database.Database;
  policy: RoutingPolicyDocument;
  chatRequest: DispatchChatRequest;
  projectContext: DispatchProjectContext;
  /** Injected clock -- this module never calls `Date.now()`/`new Date()`
   * itself for decision-making, mirroring decision.ts's own discipline. */
  clock: Date;
}

/** `[dayStartMs, dayEndMsExclusive)` for the UTC calendar day containing
 * `now` -- duplicated from routes/routing.ts's identical helper (that
 * module is not something this one may import from; the two definitions
 * are pinned to agree by `apps/daemon/tests/routing-cli-dispatch.test.ts`'s
 * own dedicated case, not by a shared import). */
function utcDayWindowMs(now: Date): [number, number] {
  const dayStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return [dayStartMs, dayStartMs + 24 * 60 * 60 * 1000];
}

/** Builds the routing key + runs the real advisory decision engine
 * end-to-end (lane meters, admission spend lookup, cooldown snapshot) --
 * shared by the 'routed' path and the 'override' path's "would have been"
 * comparison. Returns `null` when `chatRequest.taskClass` is omitted: per
 * WR-routing.md Fallback B, general chat has no §2/§15 identity to route
 * against at all, so there is nothing for `decideRouting` to do (it would
 * only ever return a typed 'error' decision for a null taskClass) -- the
 * caller of this function is what decides that `null` means
 * 'runtime-default', not this function inventing an 'error' decision that
 * was never really an error.
 */
function computeKeyAndDecision(args: {
  db: Database.Database;
  policy: RoutingPolicyDocument;
  chatRequest: DispatchChatRequest;
  projectContext: DispatchProjectContext;
  clock: Date;
}): RoutingDecision | null {
  const { db, policy, chatRequest, projectContext, clock } = args;
  const taskClass = chatRequest.taskClass ?? null;
  if (taskClass === null) return null;

  const templateId = chatRequest.templateId ?? null;
  const buildClass = chatRequest.buildClass ?? null;
  const stage = chatRequest.stage ?? 'chat';
  const sensitivityClass: RoutingDataClassification = chatRequest.sensitivityClass ?? 'client-confidential';
  const contextEstimateTokens =
    chatRequest.contextEstimateTokens ??
    (chatRequest.promptText ? estimatePromptTokens(chatRequest.promptText) : 0);

  const laneMeters = computeLaneMeters(db);
  const laneMetersRecord = Object.fromEntries(laneMeters.map((m) => [m.lane, m.throttleEvents]));
  const key: RoutingKey =
    templateId !== null && buildClass !== null
      ? { templateId, buildClass, stage, contextEstimateTokens, laneMeters: laneMetersRecord }
      : { templateId, buildClass: null, stage, contextEstimateTokens, laneMeters: laneMetersRecord };

  const buildId = chatRequest.buildId ?? projectContext.buildId ?? null;
  const [dayStartMs, dayEndMs] = utcDayWindowMs(clock);

  return decideRouting({
    policy,
    key,
    sensitivityClass,
    laneMeters,
    taskClass,
    admission: {
      buildId,
      spendLookup: {
        stageSpentUsd: buildId !== null ? computeStageSpendUsd(db, buildId, key.stage).totalCostUsd : 0,
        buildSpentUsd: buildId !== null ? computeBuildSpendUsd(db, buildId).totalCostUsd : 0,
        daySpentUsd: computeDaySpendUsd(db, dayStartMs, dayEndMs).totalCostUsd,
      },
      now: clock,
    },
    cooldown: { statuses: computeCooldownStatuses(db, resolveCooldownConfig(policy), clock) },
  });
}

function buildOverrideDecision(
  policy: RoutingPolicyDocument,
  override: DispatchRoutingOverride,
  sensitivityClass: RoutingDataClassification,
  contextEstimateTokens: number,
): RoutingDecision {
  const reason = override.reason.trim().length > 0 ? override.reason.trim() : 'no reason given';
  return {
    runtimeId: 'override',
    modelFlag: override.model,
    effort: 'inherit',
    lane: override.lane,
    rationale: `user override to ${override.model} on lane "${override.lane}": ${reason}.`,
    admissionVerdict: 'not-evaluated',
    policyVersion: policy.policyVersion,
    promptComposition: [],
    sensitivityClass,
    status: 'ok',
    reasons: [
      {
        step: 'selection',
        code: `override:${override.model}@${override.lane}`,
        message: `dispatch overridden by explicit caller request (bypasses admission/fail-closed filtering by design -- this is a deliberate user choice, not a candidate the policy evaluated): ${reason}.`,
      },
    ],
    contextEstimateTokens,
    demotions: [],
    admissionResults: [],
  };
}

function blockedResultFor(decision: RoutingDecision): ResolveDispatchRoutingResult {
  const code: DispatchBlockedError['code'] =
    decision.status === 'error' ? 'routing-error' : (decision.status as 'fail-closed-stop' | 'denied-admission');
  return {
    mode: 'blocked',
    decision,
    recordedIntent: null,
    blocked: { code, message: decision.rationale, decision },
  };
}

/**
 * Decides HOW this dispatch resolves its model/lane before spawn (plan
 * §3.1's binding point), per WR-routing.md's "Routing-key fallback
 * (normative)" table:
 *
 *   - `chatRequest.routingOverride` present -> `'override'` (unconditional;
 *     also computes the router's "would have been" decision for the audit
 *     trail when a taskClass is available).
 *   - `chatRequest.taskClass` present -> runs the real decision engine.
 *     `'ok'` -> `'routed'`. `'fail-closed-stop'` / `'denied-admission'` /
 *     `'error'` -> `'blocked'` (plan §3.2 L2: never falls through).
 *   - Otherwise (no taskClass, no override) -> `'runtime-default'`
 *     (WR-routing.md Fallback B: general chat keeps the runtime's own
 *     default and records the decision as such).
 */
export function resolveDispatchRouting(input: ResolveDispatchRoutingInput): ResolveDispatchRoutingResult {
  const { db, policy, chatRequest, projectContext, clock } = input;
  const sensitivityClass: RoutingDataClassification = chatRequest.sensitivityClass ?? 'client-confidential';
  const stage = chatRequest.stage ?? 'chat';
  const buildId = chatRequest.buildId ?? projectContext.buildId ?? null;
  const templateId = chatRequest.templateId ?? null;
  const designSystem = chatRequest.designSystemId ?? null;

  const override = chatRequest.routingOverride ?? null;
  if (override && override.model.trim().length > 0 && override.lane.trim().length > 0) {
    const contextEstimateTokens =
      chatRequest.contextEstimateTokens ??
      (chatRequest.promptText ? estimatePromptTokens(chatRequest.promptText) : 0);
    const wouldHaveBeenDecision = computeKeyAndDecision({ db, policy, chatRequest, projectContext, clock });
    const decision = buildOverrideDecision(policy, override, sensitivityClass, contextEstimateTokens);
    const recordedIntent: RecordedDispatchIntent = {
      projectId: projectContext.projectId,
      buildId,
      stage,
      templateId,
      designSystem,
      routedModel: override.model,
      routedLane: override.lane,
      sensitivityClass,
      policyVersion: policy.policyVersion,
      mode: 'override',
    };
    return { mode: 'override', decision, wouldHaveBeenDecision, recordedIntent };
  }

  const decision = computeKeyAndDecision({ db, policy, chatRequest, projectContext, clock });

  if (decision === null) {
    // WR-routing.md Fallback B: no §2/§15 identity to route against at all
    // -- keep the caller's own runtime default, record the decision as
    // 'runtime-default' (never as an 'error').
    const recordedIntent: RecordedDispatchIntent = {
      projectId: projectContext.projectId,
      buildId,
      stage,
      templateId,
      designSystem,
      routedModel: chatRequest.runtimeDefault.model,
      routedLane: chatRequest.runtimeDefault.lane,
      sensitivityClass,
      policyVersion: policy.policyVersion,
      mode: 'runtime-default',
    };
    return { mode: 'runtime-default', decision: null, recordedIntent };
  }

  if (decision.status === 'fail-closed-stop' || decision.status === 'denied-admission' || decision.status === 'error') {
    return blockedResultFor(decision);
  }

  const recordedIntent: RecordedDispatchIntent = {
    projectId: projectContext.projectId,
    buildId,
    stage,
    templateId,
    designSystem,
    routedModel: decision.modelFlag,
    routedLane: decision.lane,
    sensitivityClass: decision.sensitivityClass,
    policyVersion: decision.policyVersion,
    mode: 'routed',
  };
  return { mode: 'routed', decision, recordedIntent };
}

// ---------------------------------------------------------------------------
// recordDispatchIntent
// ---------------------------------------------------------------------------

/** Writes the PRE-SPAWN telemetry row skeleton -- the routed side of the
 * routed-vs-observed pair (plan §3.1/§3.2 L5). The observed side
 * (`observedModel`/`observedLane`/usage/gate outcomes) stays null/zeroed
 * until `reconcilePostRun` fills it once the run reports back. Never called
 * for a `'blocked'` `resolveDispatchRouting` result -- see
 * `RecordedDispatchIntent`'s own doc comment. */
export function recordDispatchIntent(
  db: Database.Database,
  runId: string,
  attempt: number,
  resolved: RecordedDispatchIntent,
): void {
  ensureRoutingTelemetryTable(db);
  const nowIso = new Date().toISOString();
  const row: StoredRoutingTelemetryRow = {
    runId,
    attempt,
    projectId: resolved.projectId,
    buildId: resolved.buildId,
    stage: resolved.stage,
    templateId: resolved.templateId,
    designSystem: resolved.designSystem,
    routedModel: resolved.routedModel,
    observedModel: null,
    routedLane: resolved.routedLane,
    observedLane: null,
    tokens: { input: 0, output: 0, cacheReadInput: 0 },
    cacheHits: 0,
    latencyMs: 0,
    costUsd: 0,
    costEstimated: true,
    gateOutcomes: {},
    escalated: false,
    policyVersion: resolved.policyVersion,
    createdAt: nowIso,
    recordedAt: nowIso,
  };
  recordRoutingTelemetry(db, row);
}

// ---------------------------------------------------------------------------
// reconcilePostRun
// ---------------------------------------------------------------------------

/** Failure categories treated as an observed-reliability signal worth
 * feeding into t7's cooldowns (plan §3.2 L1: "observed throttles... advance
 * the [fallback] chain"; plan §3.1: "spawn error/throttle categories"). A
 * narrower set than the full `TrackingRunFailureCategory` taxonomy on
 * purpose -- `auth`/`insufficient_balance`/`entitlement_required`/
 * `prompt_too_large`/`empty_output`/`tool_error`/`user_cancel` are real
 * failures, but none of them is evidence that THIS lane/runtime is
 * currently unreliable (an expired API key is a credential problem, not a
 * throttle); counting them toward a cooldown would demote a perfectly
 * healthy lane for an unrelated reason. */
const COOLDOWN_RECORDABLE_FAILURE_CATEGORIES: ReadonlySet<TrackingRunFailureCategory> = new Set([
  'rate_limit',
  'upstream_unavailable',
  'timeout',
  'process_exit',
  'model_unavailable',
]);

export interface ReconcilePostRunObserved {
  observedModel: string | null;
  observedLane: string | null;
  tokens?: { input: number; output: number; cacheReadInput: number };
  cacheHits?: number;
  latencyMs?: number;
  costUsd?: number;
  costEstimated?: boolean;
  escalated?: boolean;
  /**
   * The runtime this run actually dispatched through -- required to
   * attribute an observed failure/success to the right (runtime, lane)
   * cooldown scope (t7's `recordObservedFailure`/`clearOnSuccess`, both
   * keyed on `(runtimeId, lane)`). Omitted means the cooldown side effect
   * is skipped entirely; the reconciliation itself still runs regardless.
   */
  runtimeId?: string | null;
  /** `null`/omitted means the run succeeded -- `clearOnSuccess` runs
   * (when `runtimeId` is present) rather than `recordObservedFailure`. */
  failureCategory?: TrackingRunFailureCategory | null;
  /**
   * Side-effect kinds this run performed (plan §3.1: db-migration/
   * git-push/network-call/supabase-change -> non-redispatchable). GOVERNANCE
   * NOTE (t9): the daemon has no existing classifier that maps a run's
   * activity onto this closed vocabulary today -- `apps/daemon/src/
   * runtimes/run-lifecycle-analytics.ts`'s side-effect ledger tracks
   * artifact/preview FILE PATHS, not external side-effect CATEGORIES, and
   * `apps/daemon/src/runtimes/**` is outside this wave's lease regardless.
   * This field exists so the wiring is real and testable the moment such a
   * classifier exists; server.ts's t9 wiring does not populate it yet (see
   * this task's report's governance-amendment entry).
   */
  sideEffectKinds?: RoutingSideEffectKind[];
  /** Injected clock, same discipline as `resolveDispatchRouting`'s. */
  now: Date;
}

export interface ReconcilePostRunResult {
  /** `null` when no pre-spawn intent row exists for `(runId, attempt)` --
   * e.g. a run that never went through `recordDispatchIntent` (predates
   * this wiring, or was blocked before ever recording an intent). Never
   * throws in this case: reconciliation is a best-effort enrichment step,
   * not a hard dependency a run's own success/failure should hinge on. */
  reconciliation: RoutingReconciliation | null;
  recordedFailure: boolean;
  clearedCooldown: boolean;
  markedSideEffectKinds: RoutingSideEffectKind[];
}

/** Fills the OBSERVED side of an already-recorded telemetry row once the run
 * reports back (plan §3.1: "usage arrives post-run, sometimes estimated"),
 * computes routed-vs-observed divergence, and feeds the two safety signals
 * plan §3.2 L1/§3.1 describe: observed spawn-error/throttle failures into
 * reliability cooldowns, and any performed external side effect into the
 * non-redispatchable marking. */
export function reconcilePostRun(
  db: Database.Database,
  runId: string,
  attempt: number,
  observed: ReconcilePostRunObserved,
): ReconcilePostRunResult {
  ensureRoutingTelemetryTable(db);
  const existing = getRoutingTelemetryByRunId(db, runId, attempt);
  if (!existing) {
    return { reconciliation: null, recordedFailure: false, clearedCooldown: false, markedSideEffectKinds: [] };
  }

  const merged: StoredRoutingTelemetryRow = {
    ...existing,
    observedModel: observed.observedModel ?? existing.observedModel,
    observedLane: observed.observedLane ?? existing.observedLane,
    tokens: observed.tokens ?? existing.tokens,
    cacheHits: observed.cacheHits ?? existing.cacheHits,
    latencyMs: observed.latencyMs ?? existing.latencyMs,
    costUsd: observed.costUsd ?? existing.costUsd,
    costEstimated: observed.costEstimated ?? existing.costEstimated,
    escalated: observed.escalated ?? existing.escalated,
    recordedAt: observed.now.toISOString(),
  };
  recordRoutingTelemetry(db, merged);

  const reconciliation = reconcileRoutedVsObserved(merged);

  let recordedFailure = false;
  let clearedCooldown = false;
  if (observed.runtimeId) {
    const lane = observed.observedLane ?? existing.routedLane;
    if (observed.failureCategory && COOLDOWN_RECORDABLE_FAILURE_CATEGORIES.has(observed.failureCategory)) {
      recordObservedFailure(db, observed.runtimeId, lane, observed.failureCategory, observed.now);
      recordedFailure = true;
    } else if (!observed.failureCategory) {
      clearOnSuccess(db, observed.runtimeId, lane, observed.now);
      clearedCooldown = true;
    }
  }

  let markedSideEffectKinds: RoutingSideEffectKind[] = [];
  if (observed.sideEffectKinds && observed.sideEffectKinds.length > 0) {
    markRunSideEffects(db, runId, observed.sideEffectKinds, observed.now);
    markedSideEffectKinds = observed.sideEffectKinds;
  }

  return { reconciliation, recordedFailure, clearedCooldown, markedSideEffectKinds };
}

// ---------------------------------------------------------------------------
// computeRoutingRates
// ---------------------------------------------------------------------------

/** Every lane named anywhere in the policy's `laneChains` (both as a
 * from-lane key and as a chain member) -- the "known lane universe" used to
 * seed `computeRoutingRates`'s `laneMeters` so it is non-empty even against
 * a brand-new daemon data dir with zero routed runs yet (CWR-P2-4 requires
 * a non-empty `laneMeters` object from a bare `od route --json`). */
function allKnownLanes(policy: RoutingPolicyDocument): string[] {
  const lanes = new Set<string>();
  for (const [lane, chain] of Object.entries(policy.laneChains)) {
    lanes.add(lane);
    for (const l of chain) lanes.add(l);
  }
  return [...lanes];
}

/** The escalation-rate + gate-pass-rate (overall AND by stage/template) +
 * per-lane-meter snapshot plan §5's P2 gate requires to be "visible" --
 * GET /api/routing/rates and `od route [rates] --json` both return this
 * exact shape (`RoutingRatesResponse`). Loads the policy itself (rather than
 * taking it as a parameter) so this function's signature matches this
 * task's brief exactly (`computeRoutingRates(db, window)`); every other
 * exported function in this module that also needs the policy receives it
 * as an argument instead, because THOSE call sites already have a
 * request-scoped policy load (server.ts resolves one policy per dispatch);
 * this one does not.
 */
export function computeRoutingRates(db: Database.Database, windowMs?: number): RoutingRatesResponse {
  const policy = loadRoutingPolicy();

  const laneMeters: Record<string, LaneMeter> = {};
  for (const lane of allKnownLanes(policy)) laneMeters[lane] = emptyLaneMeter(lane);
  for (const meter of computeLaneMeters(db, windowMs)) laneMeters[meter.lane] = meter;

  const stageAggs = computeStageAggregates(db, windowMs);
  const byStage: RoutingRatesByStage[] = stageAggs.map((a) => ({
    stage: a.stage,
    templateId: a.templateId,
    runs: a.runs,
    escalationRate: a.runs > 0 ? a.escalated / a.runs : 0,
    passRate: a.gated > 0 ? a.gatedPass / a.gated : 0,
  }));

  const totalRuns = stageAggs.reduce((sum, a) => sum + a.runs, 0);
  const totalEscalated = stageAggs.reduce((sum, a) => sum + a.escalated, 0);
  const totalGated = stageAggs.reduce((sum, a) => sum + a.gated, 0);
  const totalGatedPass = stageAggs.reduce((sum, a) => sum + a.gatedPass, 0);

  return {
    windowMs: windowMs ?? null,
    totalRuns,
    escalationRate: totalRuns > 0 ? totalEscalated / totalRuns : 0,
    passRate: totalGated > 0 ? totalGatedPass / totalGated : 0,
    laneMeters,
    byStage,
  };
}
