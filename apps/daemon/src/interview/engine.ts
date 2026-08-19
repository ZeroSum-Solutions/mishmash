// F002 R1 — the client discovery interview engine. Drives a session through
// its tiered question set (packages/contracts/src/api/interviews.ts) turn by
// turn, enforcing the source questionnaire's conversational rules as
// structural/deterministic behavior rather than model-authored prose:
//
//   - ASK ONE OR TWO QUESTIONS PER MESSAGE — `buildInterviewSteps` groups
//     questions into steps of 1-2; the engine never reveals more than one
//     step at a time.
//   - PUSH BACK ON VAGUE ANSWERS for REQUIRED fields — `submitInterviewTurn`
//     rejects a vague REQUIRED answer and re-serves the SAME step instead of
//     advancing.
//   - IF I SAY I DON'T KNOW, accept it, note it, move on — an explicit
//     "I don't know" is accepted immediately (no push-back), recorded in
//     `openItems`, and the step still advances.
//   - DON'T ANNOUNCE SECTIONS — `turnMessage` never emits "Section N of M";
//     it only optionally notes rough progress once, around the halfway point.
//
// Deliberately a DETERMINISTIC state machine, not a live-model conversation.
// The source prompt's "react to what I just said" rule needs real language
// understanding to do well; building that would mean wiring this engine
// through the daemon's agent-runtime/model-invocation machinery (the same
// class of "GenUI invocation for a non-plugin, chat-agent-triggered surface"
// question F001 leaves as an open architecture decision). This engine keeps
// every acceptance criterion in the PRD provable by an unattended,
// deterministic test (scripted turns, not scripted model output) while
// staying swappable: a future live-model engine can replace this module's
// internals without changing the route, contracts, or CLI surface above it.
import { randomUUID } from 'node:crypto';
import {
  type ClientBrief,
  type GuidedCreateBrief,
  type InterviewArchetype,
  type InterviewQuestionDef,
  type InterviewSessionSummary,
  type InterviewStep,
  type InterviewTier,
  type RequiredClientBriefField,
  buildClientBrief,
  buildInterviewSteps,
  isExplicitIDontKnow,
  isRequiredClientBriefField,
  isVagueAnswer,
  mapClientBriefToGuidedBrief,
} from '@open-design/contracts';

interface StoredSession {
  id: string;
  tier: InterviewTier;
  archetype: InterviewArchetype;
  steps: readonly InterviewStep[];
  stepIndex: number;
  answers: Record<string, string>;
  status: 'in-progress' | 'complete' | 'needs-info';
  createdAt: number;
  updatedAt: number;
  /** Cached once the interview reaches a terminal state, so a reload/resume
   * (GET /api/interviews/:id) can return the same brief without re-deriving
   * it — buildClientBrief is deterministic, but recomputing on every GET
   * would silently diverge if `session.answers` were ever mutated after
   * completion. */
  result?: { clientBrief: ClientBrief; guidedBrief: GuidedCreateBrief };
}

// In-memory only for P0. Durable persistence (a SQLite schema, resume
// cursor across daemon restarts, retention/expiry) is explicitly gated on
// the P1 storage-architecture decision (CROSS-CUTTING-CORRECTIONS.md,
// decision #1: does client-facing access stay on the loopback-bound shared
// daemon, or does it need a separate hosted trust boundary?) — out of scope
// for this patch. A daemon restart drops any in-flight interview.
const sessions = new Map<string, StoredSession>();

const ACK_PHRASES: readonly string[] = [
  'Got it, thanks.',
  "That's helpful — noting that down.",
  'Good to know.',
  'Makes sense.',
  'Appreciate the detail.',
  'Thanks for that.',
];

function ackFor(stepIndex: number): string {
  return ACK_PHRASES[stepIndex % ACK_PHRASES.length] ?? 'Got it.';
}

export function summarizeInterviewSession(session: StoredSession): InterviewSessionSummary {
  return {
    id: session.id,
    tier: session.tier,
    archetype: session.archetype,
    status: session.status,
    stepIndex: session.stepIndex,
    totalSteps: session.steps.length,
  };
}

// "Once or twice along the way you can tell me roughly how far in we are,
// like 'we're about halfway.'" — never a "Section N of M" announcement.
function turnMessage(session: StoredSession): string {
  if (session.stepIndex === 0) {
    return "Hi! Let's get your site sorted — first, tell me a little about the business.";
  }
  const ack = ackFor(session.stepIndex);
  const progress = session.stepIndex / session.steps.length;
  if (progress >= 0.5 && progress < 0.5 + 1 / Math.max(session.steps.length, 1)) {
    return `${ack} We're about halfway there.`;
  }
  return ack;
}

function currentTurn(session: StoredSession): { message: string; questions: InterviewQuestionDef[] } | undefined {
  const step = session.steps[session.stepIndex];
  if (!step) return undefined;
  return { message: turnMessage(session), questions: [...step.questions] };
}

export interface StartInterviewResult {
  session: InterviewSessionSummary;
  turn: { message: string; questions: InterviewQuestionDef[] };
}

export function startInterview(
  tier: InterviewTier,
  archetype: InterviewArchetype = 'local-trade',
): StartInterviewResult {
  const steps = buildInterviewSteps(tier, archetype);
  const now = Date.now();
  const session: StoredSession = {
    id: randomUUID(),
    tier,
    archetype,
    steps,
    stepIndex: 0,
    answers: {},
    status: 'in-progress',
    createdAt: now,
    updatedAt: now,
  };
  sessions.set(session.id, session);
  const turn = currentTurn(session);
  if (!turn) {
    // Unreachable in practice — every tier has at least one question — but
    // fail loudly rather than return a malformed StartInterviewResult.
    throw new Error(`interview tier "${tier}" produced no questions`);
  }
  return { session: summarizeInterviewSession(session), turn };
}

export interface InterviewSessionState {
  session: InterviewSessionSummary;
  turn?: { message: string; questions: InterviewQuestionDef[] };
  result?: { clientBrief: ClientBrief; guidedBrief: GuidedCreateBrief };
}

/**
 * Fetches a session's current state for GET /api/interviews/:id — the same
 * shape a turn submission returns, so a client (e.g. a reloaded browser tab)
 * can resume an in-progress session by reconstructing its current turn, or
 * redisplay a terminal session's cached result, without replaying answers.
 */
export function getInterviewSessionState(id: string): InterviewSessionState | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  if (session.status === 'in-progress') {
    const turn = currentTurn(session);
    return { session: summarizeInterviewSession(session), ...(turn ? { turn } : {}) };
  }
  return {
    session: summarizeInterviewSession(session),
    ...(session.result ? { result: session.result } : {}),
  };
}

export interface SubmitTurnResult {
  session: InterviewSessionSummary;
  turn?: { message: string; questions: InterviewQuestionDef[] };
  result?: { clientBrief: ClientBrief; guidedBrief: GuidedCreateBrief };
  pushBack?: { fieldId: string; message: string };
}

export type SubmitTurnOutcome =
  | { ok: true; data: SubmitTurnResult }
  | { ok: false; status: 404 | 400; error: string };

/**
 * Advances one interview session by one turn. `answers` is keyed by
 * question id for every question in the session's CURRENT step — any other
 * keys are ignored.
 */
export function submitInterviewTurn(
  id: string,
  answers: Readonly<Record<string, unknown>>,
): SubmitTurnOutcome {
  const session = sessions.get(id);
  if (!session) return { ok: false, status: 404, error: 'interview session not found' };
  if (session.status !== 'in-progress') {
    return { ok: false, status: 400, error: `interview is already ${session.status}` };
  }
  const step = session.steps[session.stepIndex];
  if (!step) return { ok: false, status: 400, error: 'interview has no remaining steps' };

  // PUSH BACK ON VAGUE ANSWERS: for anything REQUIRED, do not accept a
  // hand-wavy answer — ask again instead of advancing. An explicit
  // "I don't know" is accepted immediately (see module docblock); a blank
  // answer is treated as "skipped" by buildClientBrief once the interview
  // ends, not pushed back on mid-conversation (the source rule only pushes
  // back on a vague ANSWER, not silence).
  for (const question of step.questions) {
    if (!question.required || !isRequiredClientBriefField(question.id)) continue;
    const raw = answers[question.id];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value.length === 0) continue;
    if (isExplicitIDontKnow(value)) continue;
    const fieldId: RequiredClientBriefField = question.id;
    if (isVagueAnswer(fieldId, value)) {
      session.updatedAt = Date.now();
      return {
        ok: true,
        data: {
          session: summarizeInterviewSession(session),
          turn: { message: turnMessage(session), questions: [...step.questions] },
          pushBack: {
            fieldId: question.id,
            message: `I need something more specific for "${question.label}" — could you give me the actual details?`,
          },
        },
      };
    }
  }

  for (const question of step.questions) {
    const raw = answers[question.id];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      session.answers[question.id] = raw.trim();
    }
  }
  session.stepIndex += 1;
  session.updatedAt = Date.now();

  const nextTurn = currentTurn(session);
  if (nextTurn) {
    return { ok: true, data: { session: summarizeInterviewSession(session), turn: nextTurn } };
  }

  const clientBrief = buildClientBrief(session.tier, session.archetype, session.answers);
  session.status = clientBrief.status;
  const guidedBrief = mapClientBriefToGuidedBrief(clientBrief);
  session.result = { clientBrief, guidedBrief };
  return {
    ok: true,
    data: { session: summarizeInterviewSession(session), result: session.result },
  };
}

/** Test-only: clears the in-memory store between suites that share a process. */
export function __resetInterviewStoreForTests(): void {
  sessions.clear();
}
