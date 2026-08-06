// Advisory dispatch-time decision engine (WR wave, P2 tranche -- plan
// docs/plans/2026-08-05-model-routing-system.md §3.1 routing key, §3.2 L2
// policy semantics, §2 model assignments).
//
// PURE by design: `decideRouting` takes a loaded policy + a routing key + a
// sensitivity class + a lane-meter snapshot + a task-class identifier, and
// returns a RoutingDecision. No I/O, no dispatch/spawn side effects (t9's
// job), no cooldown persistence (t7's job -- lane meters arrive as a plain
// argument, this module never reads or writes telemetry itself). This is
// what makes the algorithm table-testable: every test in
// apps/daemon/tests/routing-decision.test.ts constructs its inputs in
// memory and asserts on the returned RoutingDecision, no daemon boot, no
// SQLite, no network.
//
// t6 update (plan §3.1 budget bullet, §3.2 L4): admission control now wires
// in through the OPTIONAL `admission` input below, via
// `apps/daemon/src/routing/admission.ts`'s pure `evaluateAdmission` --
// itself just as I/O-free as this module (spend numbers and the clock arrive
// as plain arguments; this file never calls Date.now() or touches SQLite).
// Omitting `admission` entirely reproduces the exact pre-t6 behavior
// (`admissionVerdict: 'not-evaluated'`, `admissionResults: []`) for every
// existing caller/test that never opts in.
//
// Selection algorithm (this task's brief, plan §2/§3.1/§3.2 L2):
//   (a) resolve the §2 model-table row via match rules (task class + stage,
//       against the policy's own closed stage vocabulary -- an unknown
//       stage is a typed 'error' decision, never a fallback row);
//   (b) a §15 programAssignments selector match pins the head candidate to
//       its named model+requiredLane, ahead of whatever (a) resolved;
//   (c) filter the ordered candidate list (primary -> burst -> cheap) by
//       hard constraints (modelFamily x allowedTransports/forbiddenTransports)
//       and by the sensitivity class's data-classification allowlist;
//   (d) walk the survivors in order, demoting (skipping) any candidate whose
//       lane meter shows recent throttle events;
//   (e) if (c) or (d) empties the list, FAIL-CLOSED: stop, never fall
//       through to an out-of-class or unlisted candidate.
import {
  isFiniteNonNegativeInteger,
  type LaneMeter,
  type RoutingAdmissionCandidateResult,
  type RoutingAdmissionVerdict,
  type RoutingCandidate,
  type RoutingDataClassification,
  type RoutingDecision,
  type RoutingDecisionReason,
  type RoutingDecisionReasonStep,
  type RoutingKey,
  type RoutingLaneDemotion,
  type RoutingMatchRule,
  type RoutingPolicyDataClassAllowlist,
  type RoutingPolicyDocument,
  type RoutingPolicyHardConstraint,
  type RoutingPolicyModelTableEntry,
  type RoutingPolicyProgramAssignment,
  type RoutingTransport,
} from '@open-design/contracts';
import { evaluateAdmission, type AdmissionSpendLookup } from './admission.js';

/** Sol review MED-2: the canonical subscription -> prepaid -> metered ->
 * local tier order (plan §2 "Lane realism"). Used to sort candidates before
 * the demotion walk below -- see `sortByTransportTier`'s own doc comment for
 * why this beats consulting `policy.laneChains` directly (the three
 * subscription lanes never co-occur in any one chain array, so a chain
 * can't by itself tell two same-tier lanes apart; `transport` already
 * carries exactly that grouping on every candidate). */
const TRANSPORT_TIER: Record<RoutingTransport, number> = {
  'subscription-oauth': 0,
  prepaid: 1,
  'metered-api': 2,
  local: 3,
};

export interface DecideRoutingInput {
  policy: RoutingPolicyDocument;
  key: RoutingKey;
  sensitivityClass: RoutingDataClassification;
  /** Lane-meter snapshot the caller already computed (e.g.
   * apps/daemon/src/routing/telemetry.ts's `computeLaneMeters`) -- this
   * module never queries telemetry itself (t7 owns cooldown persistence;
   * "meters come in as arguments" per this task's Discipline section). */
  laneMeters: LaneMeter[];
  /**
   * Identifies the work against BOTH vocabularies the policy carries: a §2
   * `modelTable[].match.taskClass` (e.g. `'section-component-codegen'`) and
   * a §15 `programAssignments[].taskSelector` (e.g. `'code-adversary'`).
   * These are deliberately different identifier spaces (see
   * routing-policy.ts's own doc comments on RoutingPolicyProgramAssignment)
   * -- a single call may match one, the other, both, or neither. `null` for
   * work with no §2/§15 identity at all (WR-routing.md Fallback B: general
   * chat, "runtime default resolves the model" -- a runtime default is
   * something the DISPATCH layer knows, not this policy-driven engine, so
   * this returns a typed 'error' rather than fabricating one).
   */
  taskClass: string | null;
  /**
   * A lane is treated as unavailable when its `LaneMeter#throttleEvents`
   * strictly exceeds this count. Defaults to 0 (any observed throttle event
   * demotes) -- plan §3.1 L1: "observed throttles... advance the chain."
   * Exposed as a parameter rather than a policy field, per this task's
   * brief ("window per policy or parameter"): the WINDOW itself is already
   * baked into the `laneMeters` snapshot the caller passed in (e.g.
   * `computeLaneMeters(db, windowMs)`), so this only tunes the count
   * threshold within that window.
   */
  maxThrottleEvents?: number;
  /**
   * t6 (plan §3.1/§3.2 L4 admission control): optional so every pre-t6
   * caller/test keeps working unchanged with `admissionVerdict:
   * 'not-evaluated'` and `admissionResults: []` (the exact old behavior).
   * When present, `decideRouting` evaluates each already-classification-safe,
   * non-throttled candidate via `evaluateAdmission` (in transport-tier
   * order, same walk as the lane-throttle demotion loop) and only selects
   * one that is admitted -- see the walk's own comment below for exactly
   * how this composes with throttle demotion.
   */
  admission?: {
    buildId: string | null;
    spendLookup: AdmissionSpendLookup;
    /** Injected clock, threaded straight through to `evaluateAdmission` --
     * keeps this module free of `Date.now()` the same way `laneMeters`
     * keeps it free of a live telemetry query. */
    now: Date;
  };
}

/**
 * v1 context estimator (plan §3.1 wants a tokenizer-estimated context of the
 * composed prompt; this is the deliberately crude placeholder until a real
 * tokenizer is wired in): the standard rough English-text heuristic of
 * ~4 characters per token. Exposed as its own named export -- NOT called by
 * `decideRouting` itself, which only ever consumes an already-computed
 * `key.contextEstimateTokens` -- so a caller (routes/routing.ts today) can
 * swap in a real tokenizer later without touching the decision engine.
 */
export function estimatePromptTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function matchesRule(
  rule: RoutingMatchRule,
  ctx: { taskClass: string | null; stage: string; templateId: string | null; contextEstimateTokens: number },
): boolean {
  if (rule.taskClass !== undefined && rule.taskClass !== ctx.taskClass) return false;
  if (rule.stage !== undefined && rule.stage !== ctx.stage) return false;
  if (rule.templateId !== undefined && rule.templateId !== ctx.templateId) return false;
  // [minContextTokens, maxContextTokens) -- routing-policy.ts's own doc
  // comment on RoutingMatchRule.
  if (rule.minContextTokens !== undefined && ctx.contextEstimateTokens < rule.minContextTokens) return false;
  if (rule.maxContextTokens !== undefined && ctx.contextEstimateTokens >= rule.maxContextTokens) return false;
  return true;
}

/** First matching row in `modelTable` array order. Multiple rows can share
 * a `taskClass` (the review-panel and long-context-ops rows do, by the
 * policy's own documented schema-limit workaround for a plan cell naming
 * two required parallel models) -- this deliberately picks the first one
 * deterministically rather than trying to reconcile them into one decision;
 * reconciling parallel-panelist rows into a single RoutingDecision is a
 * different concern this pure per-call function does not attempt. */
function findMatchedRow(
  policy: RoutingPolicyDocument,
  ctx: { taskClass: string | null; stage: string; templateId: string | null; contextEstimateTokens: number },
): RoutingPolicyModelTableEntry | null {
  return policy.modelTable.find((entry) => matchesRule(entry.match, ctx)) ?? null;
}

function candidatesOf(entry: RoutingPolicyModelTableEntry): RoutingCandidate[] {
  return [entry.primary, entry.burst, entry.cheap].filter((c): c is RoutingCandidate => c !== undefined);
}

/** Resolves a §15 program assignment's `model`+`requiredLane` pair into a
 * full RoutingCandidate by finding a candidate ANYWHERE in `modelTable` that
 * already carries that exact (model, lane) pair -- reusing its
 * `runtimeId`/`transport`/`modelFamily` rather than fabricating them, since
 * RoutingPolicyProgramAssignment itself carries none of those three fields
 * (see its own doc comment). Every one of the v1 policy's five assignments
 * resolves this way (grok-4.5/nous, claude-fable-5/claude-code-oauth,
 * deepseek-v4-flash/deepseek-direct, "Gemini 3.1 Pro (High)"/agy,
 * claude-opus-5/claude-code-oauth all appear as a modelTable candidate).
 * Returns null rather than inventing an unverified candidate when no such
 * pair exists anywhere in the table -- the caller turns that into an
 * 'error' decision instead of dispatching something never actually vetted
 * against a hard constraint. */
function findCandidateForAssignment(
  policy: RoutingPolicyDocument,
  assignment: RoutingPolicyProgramAssignment,
): RoutingCandidate | null {
  for (const entry of policy.modelTable) {
    for (const candidate of candidatesOf(entry)) {
      if (candidate.model === assignment.model && candidate.lane === assignment.requiredLane) {
        return assignment.dispatchValidation !== undefined
          ? { ...candidate, dispatchValidation: assignment.dispatchValidation }
          : candidate;
      }
    }
  }
  return null;
}

function filterByHardConstraints(
  candidates: RoutingCandidate[],
  hardConstraints: RoutingPolicyHardConstraint[],
): { survivors: RoutingCandidate[]; removed: RoutingDecisionReason[] } {
  const removed: RoutingDecisionReason[] = [];
  const survivors = candidates.filter((candidate) => {
    for (const constraint of hardConstraints) {
      if (constraint.modelFamily !== candidate.modelFamily) continue;
      const violatesAllowlist =
        constraint.allowedTransports !== undefined && !constraint.allowedTransports.includes(candidate.transport);
      const violatesForbidden = constraint.forbiddenTransports.includes(candidate.transport);
      // Sol review MED-3: transport alone cannot express "this SPECIFIC
      // lane, not just any lane on this transport" -- PRD §15's "Grok 4.5
      // dispatches only through the prepaid Nous Portal lane" would
      // otherwise happily admit a Grok candidate routed through Moonshot,
      // which is ALSO `prepaid`.
      const violatesRequiredLane = constraint.requiredLane !== undefined && candidate.lane !== constraint.requiredLane;
      if (violatesAllowlist || violatesForbidden || violatesRequiredLane) {
        removed.push({
          step: 'hard-constraint-filter',
          code: `constraint:${constraint.id}`,
          message: `candidate "${candidate.model}" on lane "${candidate.lane}" (transport ${candidate.transport}) removed by hard constraint "${constraint.id}": ${constraint.description}`,
        });
        return false;
      }
    }
    return true;
  });
  return { survivors, removed };
}

/** Sol review MED-2: a row's primary/burst/cheap declaration order is a
 * TASK-FIT preference (which model best suits the work), not necessarily an
 * AVAILABILITY tier ordering -- token-distill's row, for instance,
 * legitimately declares primary=deepseek-v4-flash (metered) before
 * burst=kimi-k3 (prepaid) because deepseek is the right model for token
 * distillation, not because it is the more available lane. But the
 * demotion walk's whole PURPOSE is availability fallback (plan §2 "Lane
 * realism": "observed throttles... advance the chain subscription ->
 * prepaid -> metered"), so it must walk candidates in TRUE tier order, not
 * raw declaration order, or it can end up preferring a worse-tier candidate
 * over a same-or-better-tier one purely because of where it sits in the row.
 * `Array#sort` is a stable sort (ECMA-262, guaranteed since ES2019), so
 * candidates within the same tier keep their original primary -> burst ->
 * cheap relative order -- this only ever reorders ACROSS tiers. */
function sortByTransportTier(candidates: RoutingCandidate[]): RoutingCandidate[] {
  return [...candidates].sort((a, b) => TRANSPORT_TIER[a.transport] - TRANSPORT_TIER[b.transport]);
}

/**
 * Sol review MED-4: a comparison against `NaN` is ALWAYS `false`
 * (`NaN > 0` is `false`), which makes an unvalidated `throttleEvents: NaN`
 * silently FAIL OPEN in the demotion walk below -- a NaN-corrupted meter
 * would read as "never throttled" instead of raising an alarm. Validating
 * every numeric core input up front, before any routing logic runs, turns
 * that into an honest typed 'error' decision instead. Returns a
 * human-readable reason string on failure, `null` when everything is valid.
 */
function findInvalidCoreInputReason(key: RoutingKey, laneMeters: LaneMeter[], maxThrottleEvents: number): string | null {
  if (!isFiniteNonNegativeInteger(key.contextEstimateTokens)) {
    return `key.contextEstimateTokens must be a finite nonnegative integer, got ${key.contextEstimateTokens}`;
  }
  if (!isFiniteNonNegativeInteger(maxThrottleEvents)) {
    return `maxThrottleEvents must be a finite nonnegative integer, got ${maxThrottleEvents}`;
  }
  for (const meter of laneMeters) {
    if (!isFiniteNonNegativeInteger(meter.throttleEvents)) {
      return `laneMeters entry for lane "${meter.lane}" has an invalid throttleEvents (must be a finite nonnegative integer, got ${meter.throttleEvents})`;
    }
  }
  return null;
}

function filterByDataClassification(
  candidates: RoutingCandidate[],
  allowlist: RoutingPolicyDataClassAllowlist | null,
  sensitivityClass: RoutingDataClassification,
): { survivors: RoutingCandidate[]; removed: RoutingDecisionReason[] } {
  const removed: RoutingDecisionReason[] = [];
  if (!allowlist) {
    // No allowlist entry at all for this classification -- fail-closed by
    // construction (plan §3.2 L2, Sol v2-HIGH-1): nothing survives rather
    // than treating "no entry" as "no restriction."
    for (const candidate of candidates) {
      removed.push({
        step: 'data-classification-filter',
        code: `class-undefined:${sensitivityClass}`,
        message: `candidate "${candidate.model}" on lane "${candidate.lane}" removed: this policy version has no allowlist entry for sensitivity class "${sensitivityClass}".`,
      });
    }
    return { survivors: [], removed };
  }
  const survivors = candidates.filter((candidate) => {
    if (allowlist.allowedLanes.includes(candidate.lane)) return true;
    removed.push({
      step: 'data-classification-filter',
      code: `class-filtered:${sensitivityClass}`,
      message: `candidate "${candidate.model}" on lane "${candidate.lane}" removed: lane is not in the "${sensitivityClass}" allowlist (${allowlist.allowedLanes.join(', ')}).`,
    });
    return false;
  });
  return { survivors, removed };
}

function terminalDecision(args: {
  policy: RoutingPolicyDocument;
  /** Sol review MED-4: taken as an already-validated plain number (never
   * `key.contextEstimateTokens` directly) so an input-validation failure
   * can report a SAFE sentinel (0) instead of propagating the very NaN/
   * Infinity/negative value that triggered the error into the decision
   * object itself. */
  contextEstimateTokens: number;
  sensitivityClass: RoutingDataClassification;
  status: 'fail-closed-stop' | 'error' | 'denied-admission';
  reasons: RoutingDecisionReason[];
  demotions: RoutingLaneDemotion[];
  rationale: string;
  /** t6: only the new 'denied-admission' terminal path passes these;
   * every pre-existing call site (stage-validation error, no-candidates
   * error, classification-exhausted fail-closed-stop) omits them and gets
   * the exact pre-t6 defaults back. */
  admissionResults?: RoutingAdmissionCandidateResult[];
  admissionVerdict?: RoutingAdmissionVerdict;
}): RoutingDecision {
  return {
    runtimeId: 'none',
    modelFlag: 'none',
    effort: 'inherit',
    lane: 'none',
    rationale: args.rationale,
    admissionVerdict: args.admissionVerdict ?? 'not-evaluated',
    policyVersion: args.policy.policyVersion,
    promptComposition: [],
    sensitivityClass: args.sensitivityClass,
    status: args.status,
    reasons: args.reasons,
    contextEstimateTokens: args.contextEstimateTokens,
    demotions: args.demotions,
    admissionResults: args.admissionResults ?? [],
  };
}

function pushReason(reasons: RoutingDecisionReason[], step: RoutingDecisionReasonStep, code: string, message: string): void {
  reasons.push({ step, code, message });
}

function buildRationale(
  selected: RoutingCandidate,
  demotionCount: number,
  assignment: RoutingPolicyProgramAssignment | null,
  matchedRow: RoutingPolicyModelTableEntry | null,
  taskClass: string | null,
): string {
  const origin = assignment
    ? `§15 assignment "${assignment.taskSelector}" pinned`
    : matchedRow
      ? `§2 task class "${taskClass}" resolved`
      : 'no §2/§15 match';
  const demotionNote = demotionCount > 0 ? ` after ${demotionCount} throttle demotion(s)` : '';
  return `${origin} to ${selected.model} on lane "${selected.lane}"${demotionNote}.`;
}

export function decideRouting(input: DecideRoutingInput): RoutingDecision {
  const { policy, key, sensitivityClass, laneMeters, taskClass } = input;
  const maxThrottleEvents = input.maxThrottleEvents ?? 0;
  const reasons: RoutingDecisionReason[] = [];

  // (0) Input validation -- Sol review MED-4, runs before ANYTHING else.
  // A NaN/Infinity/negative/fractional core input (contextEstimateTokens,
  // maxThrottleEvents, any laneMeters[].throttleEvents) must never reach a
  // comparison that could silently fail OPEN; it is a typed 'error'
  // decision instead. `key.contextEstimateTokens` itself may be the
  // invalid value, so the returned decision reports a safe `0` sentinel
  // rather than propagating it.
  const invalidInputReason = findInvalidCoreInputReason(key, laneMeters, maxThrottleEvents);
  if (invalidInputReason !== null) {
    pushReason(reasons, 'error', 'invalid-input', invalidInputReason);
    const safeContextEstimateTokens = isFiniteNonNegativeInteger(key.contextEstimateTokens) ? key.contextEstimateTokens : 0;
    return terminalDecision({
      policy,
      contextEstimateTokens: safeContextEstimateTokens,
      sensitivityClass,
      status: 'error',
      reasons,
      demotions: [],
      rationale: invalidInputReason,
    });
  }

  // (a1) Stage validation -- closed vocabulary, unknown stage is a typed
  // error, never a fallback row. Sol review HIGH-1 (t5 fix commit): the
  // closed set is `policy.stageVocabulary`, NOT
  // `budgetCeilings.perStageEstimatedCostUsd`'s keys -- the latter is a
  // coarser cost-ceiling bucket set that deliberately omits WR-routing.md's
  // Fallback-C granular ingestion sub-stages (classify/extract/distill/
  // verify/register), which must still be ROUTABLE even with no per-
  // sub-stage budget ceiling (a budget ceiling is t6's admission-control
  // concern, not a routability gate this engine owns).
  const closedStages = new Set(policy.stageVocabulary);
  if (!closedStages.has(key.stage)) {
    pushReason(
      reasons,
      'stage-validation',
      `unknown-stage:${key.stage}`,
      `stage "${key.stage}" is outside this policy's closed stage vocabulary (${[...closedStages].join(', ')}); refusing to fall back to any model-table row.`,
    );
    return terminalDecision({
      policy,
      contextEstimateTokens: key.contextEstimateTokens,
      sensitivityClass,
      status: 'error',
      reasons,
      demotions: [],
      rationale: `unknown stage "${key.stage}".`,
    });
  }
  pushReason(reasons, 'stage-validation', `stage-ok:${key.stage}`, `stage "${key.stage}" is within the closed vocabulary.`);

  // (a2) Resolve the §2 model-table row.
  const matchCtx = { taskClass, stage: key.stage, templateId: key.templateId, contextEstimateTokens: key.contextEstimateTokens };
  const matchedRow = findMatchedRow(policy, matchCtx);
  if (matchedRow) {
    pushReason(
      reasons,
      'model-table-match',
      `matched:${taskClass}`,
      `matched model-table row for taskClass "${taskClass}" (primary ${matchedRow.primary.model} on "${matchedRow.primary.lane}").`,
    );
  } else {
    pushReason(
      reasons,
      'model-table-match',
      'no-model-table-match',
      taskClass
        ? `no model-table row matches taskClass "${taskClass}" at stage "${key.stage}" (context ${key.contextEstimateTokens} tokens).`
        : 'no taskClass supplied; no §2 model-table row to match (e.g. general chat, WR-routing.md Fallback B).',
    );
  }

  // (b) programAssignments override -- pins the head candidate.
  const assignment = taskClass ? (policy.programAssignments ?? []).find((a) => a.taskSelector === taskClass) ?? null : null;
  let candidates: RoutingCandidate[] = matchedRow ? candidatesOf(matchedRow) : [];

  if (assignment) {
    const pinned = findCandidateForAssignment(policy, assignment);
    if (pinned) {
      pushReason(
        reasons,
        'program-assignment',
        `assignment:${assignment.taskSelector}`,
        `§15 program assignment "${assignment.taskSelector}" pins the head candidate to ${pinned.model} on lane "${pinned.lane}" (${assignment.note}).`,
      );
      const rest = candidates.filter((c) => !(c.model === pinned.model && c.lane === pinned.lane));
      candidates = [pinned, ...rest];
    } else {
      pushReason(
        reasons,
        'program-assignment',
        `assignment-unresolved:${assignment.taskSelector}`,
        `§15 program assignment "${assignment.taskSelector}" names model "${assignment.model}" on lane "${assignment.requiredLane}", but no modelTable candidate anywhere in the policy carries that exact (model, lane) pair to source runtimeId/transport/modelFamily from -- refusing to fabricate an unverified candidate.`,
      );
    }
  }

  if (candidates.length === 0) {
    const message = taskClass
      ? `neither a §2 model-table row nor a §15 program assignment resolves taskClass "${taskClass}" at stage "${key.stage}".`
      : 'no taskClass supplied and no §15 assignment applies; the dispatch layer must apply its own runtime default (WR-routing.md Fallback B).';
    pushReason(reasons, 'error', 'no-candidates', message);
    return terminalDecision({
      policy,
      contextEstimateTokens: key.contextEstimateTokens,
      sensitivityClass,
      status: 'error',
      reasons,
      demotions: [],
      rationale: message,
    });
  }

  // (c) Filter: hard constraints, then the sensitivity class's
  // data-classification allowlist.
  const { survivors: afterConstraints, removed: constraintRemovals } = filterByHardConstraints(candidates, policy.hardConstraints);
  reasons.push(...constraintRemovals);

  const classAllowlist = policy.dataClassificationAllowlists.find((a) => a.classification === sensitivityClass) ?? null;
  const { survivors: afterClassification, removed: classRemovals } = filterByDataClassification(
    afterConstraints,
    classAllowlist,
    sensitivityClass,
  );
  reasons.push(...classRemovals);

  if (afterClassification.length === 0) {
    const message = classAllowlist
      ? `every remaining candidate for taskClass "${taskClass}" was removed by hard constraints or the "${sensitivityClass}" data-classification allowlist; refusing to fall through to an out-of-class lane.`
      : `sensitivityClass "${sensitivityClass}" has no allowlist entry in policy version ${policy.policyVersion}; fail-closed by construction.`;
    pushReason(reasons, 'fail-closed', `class-exhausted:${sensitivityClass}`, message);
    return terminalDecision({
      policy,
      contextEstimateTokens: key.contextEstimateTokens,
      sensitivityClass,
      status: 'fail-closed-stop',
      reasons,
      demotions: [],
      rationale: message,
    });
  }

  // dispatchValidation flags are carried through, not filtered on -- the
  // dispatch layer (t9) is what actually re-checks a slug before spawning.
  for (const candidate of afterClassification) {
    if (candidate.dispatchValidation?.slugRecheckAtDispatch) {
      pushReason(
        reasons,
        'selection',
        `dispatch-validation:${candidate.model}`,
        `candidate "${candidate.model}" carries dispatchValidation.slugRecheckAtDispatch -- the dispatch layer must re-verify this slug before spawning; not evaluated here.`,
      );
    }
  }

  // (d) Lane-availability advance: walk the already-filtered, already
  // classification-safe candidate list IN TRANSPORT-TIER ORDER (Sol review
  // MED-2 -- see sortByTransportTier's own doc comment for why raw
  // primary->burst->cheap declaration order is not always tier-ascending),
  // demoting past any lane whose meter shows recent throttle events.
  // Deliberately does NOT consult policy.laneChains to synthesize a NEW
  // candidate outside this list -- routing-policy.json's own top-level
  // notes say laneChains "does not itself intersect with hardConstraints"
  // and applying it before a hard-constraint/classification check is a
  // different layer's job. Demoting only within the already-filtered list
  // is what makes the (e) fail-closed guarantee below airtight: it can
  // never introduce a lane the classification filter just removed.
  //
  // t6: a non-throttled candidate that clears this walk is now ALSO checked
  // against budget admission control (`evaluateAdmission`, only when the
  // caller opted in via `input.admission`) before it is accepted as
  // `selected` -- a denied candidate is skipped in favor of the next one in
  // tier order (e.g. a build-cap-denied primary falls through to a cheaper
  // `cheap` candidate that still fits), exactly the same "try the next one"
  // shape the throttle-demotion loop already has. Every evaluated result is
  // collected into `admissionResults` regardless of verdict, including ones
  // for candidates ultimately skipped in favor of a later admit -- that is
  // the "why NOT the primary" trail plan §3.2 L4's UI surfaces need.
  const tieredCandidates = sortByTransportTier(afterClassification);
  const meterByLane = new Map(laneMeters.map((m) => [m.lane, m] as const));
  const demotions: RoutingLaneDemotion[] = [];
  const admissionResults: RoutingAdmissionCandidateResult[] = [];
  let selected: RoutingCandidate | null = null;
  for (let i = 0; i < tieredCandidates.length; i += 1) {
    const candidate = tieredCandidates[i]!;
    const throttleEvents = meterByLane.get(candidate.lane)?.throttleEvents ?? 0;
    if (throttleEvents > maxThrottleEvents) {
      const next = tieredCandidates[i + 1] ?? null;
      const reason = `lane "${candidate.lane}" shows ${throttleEvents} throttle event(s) (> threshold ${maxThrottleEvents}); demoting${next ? ` to "${next.lane}"` : ' -- no candidate remains'}.`;
      demotions.push({ fromLane: candidate.lane, toLane: next?.lane ?? null, reason });
      pushReason(reasons, 'lane-throttle-demotion', `throttled:${candidate.lane}`, reason);
      continue;
    }
    if (input.admission) {
      const admissionResult = evaluateAdmission({
        policy,
        stage: key.stage,
        taskClass,
        candidate,
        contextEstimateTokens: key.contextEstimateTokens,
        buildId: input.admission.buildId,
        spendLookup: input.admission.spendLookup,
        now: input.admission.now,
      });
      admissionResults.push(admissionResult);
      if (admissionResult.verdict !== 'admit') {
        const next = tieredCandidates[i + 1] ?? null;
        pushReason(
          reasons,
          'admission-denied',
          `admission:${admissionResult.verdict}:${candidate.model}@${candidate.lane}`,
          `${admissionResult.reason}${next ? ` Trying next candidate "${next.model}" on lane "${next.lane}".` : ' No candidate remains.'}`,
        );
        continue;
      }
    }
    selected = candidate;
    break;
  }

  // (e) FAIL-CLOSED / DENIED-ADMISSION: the walk above exhausted every
  // candidate. Sol review MED-3 (fix-round): the terminal cause per
  // candidate is one of 'throttled' (recorded in `demotions`) or
  // 'admission-denied' (recorded in `admissionResults`) -- class/constraint
  // filtering already produced ITS OWN terminal 'fail-closed-stop'/'error'
  // earlier, in step (c), before this walk ever starts, so those two causes
  // never reach this branch. Three distinct combinations of the two causes
  // that DO reach here:
  //   - PURE throttle exhaustion (every survivor throttled, `admissionResults`
  //     stays empty -- including whenever admission was never engaged at
  //     all): unchanged pre-t6 'fail-closed-stop' behavior.
  //   - PURE admission exhaustion (`demotions` stays empty, at least one
  //     candidate reached admission and was denied): the 'denied-admission'
  //     status, carrying every evaluated candidate's verdict+reason.
  //   - MIXED (at least one candidate throttled AND at least one reached
  //     admission and was denied): reported as 'fail-closed-stop' -- the
  //     more conservative, human-surfaced signal, since availability
  //     problems (throttling) are graver than a budget problem alone --
  //     but `admissionResults` is still retained on the terminal decision
  //     so the "why not this candidate" trail isn't silently dropped.
  if (!selected) {
    const anyThrottled = demotions.length > 0;
    const anyAdmissionDenied = admissionResults.length > 0;
    if (!anyThrottled && anyAdmissionDenied) {
      const message = `every remaining candidate for sensitivity class "${sensitivityClass}" was denied by budget admission control (stage/build/day ceilings or the metered kill-switch); refusing to dispatch.`;
      pushReason(reasons, 'admission-denied', `admission-exhausted:${sensitivityClass}`, message);
      return terminalDecision({
        policy,
        contextEstimateTokens: key.contextEstimateTokens,
        sensitivityClass,
        status: 'denied-admission',
        reasons,
        demotions,
        rationale: message,
        admissionResults,
        admissionVerdict: 'denied',
      });
    }
    const message = anyThrottled && anyAdmissionDenied
      ? `every remaining candidate for sensitivity class "${sensitivityClass}" was either throttled or denied by budget admission control; refusing to fall through (mixed availability/budget exhaustion reports as fail-closed, the more conservative signal).`
      : `every remaining candidate for sensitivity class "${sensitivityClass}" is currently throttled; refusing to fall through to an out-of-class or unlisted lane.`;
    pushReason(reasons, 'fail-closed', `${anyAdmissionDenied ? 'mixed' : 'throttle'}-exhausted:${sensitivityClass}`, message);
    return terminalDecision({
      policy,
      contextEstimateTokens: key.contextEstimateTokens,
      sensitivityClass,
      status: 'fail-closed-stop',
      reasons,
      demotions,
      rationale: message,
      admissionResults,
      admissionVerdict: anyAdmissionDenied ? 'denied' : 'not-evaluated',
    });
  }

  pushReason(
    reasons,
    'selection',
    `selected:${selected.model}@${selected.lane}`,
    `selected ${selected.model} on lane "${selected.lane}" (effort ${selected.effort}).`,
  );

  return {
    runtimeId: selected.runtimeId,
    modelFlag: selected.model,
    effort: selected.effort,
    lane: selected.lane,
    rationale: buildRationale(selected, demotions.length, assignment, matchedRow, taskClass),
    admissionVerdict: input.admission ? 'admitted' : 'not-evaluated',
    policyVersion: policy.policyVersion,
    promptComposition: [],
    sensitivityClass,
    status: 'ok',
    reasons,
    contextEstimateTokens: key.contextEstimateTokens,
    demotions,
    admissionResults,
  };
}
