import type { ChatRunStatus } from '@open-design/contracts';
import type { ChatMessage } from '../types';
import { isRetryableAssistantTerminalFailure } from './design-delivery';

function isFailedAssistantRow(message: ChatMessage): boolean {
  return message.role === 'assistant' && isRetryableAssistantTerminalFailure(message);
}

function isActiveRunStatus(status: ChatMessage['runStatus']): boolean {
  return status === 'queued' || status === 'running';
}

/**
 * The mark the transport puts on an error it minted ITSELF, out of a broken
 * connection rather than out of anything the daemon said about the run.
 *
 * The distinction cannot be recovered downstream. A daemon `error` frame with
 * no `code` and a non-OK event-stream response both arrive as a plain `Error`
 * with a message, yet one is the daemon's verdict on the turn and the other is
 * this client's report of its own connection. Only `providers/daemon.ts` knows
 * which it just built, so it says so here and every pane reads the answer
 * through `isUnadjudicatedStreamFailure`.
 */
const UNADJUDICATED_STREAM_FAILURE = 'unadjudicatedStreamFailure';

/** Stamp an error the transport minted for itself. See the constant above. */
export function markStreamUnadjudicated<E extends Error>(error: E): E {
  Object.defineProperty(error, UNADJUDICATED_STREAM_FAILURE, {
    value: true,
    enumerable: false,
    configurable: true,
  });
  return error;
}

/**
 * A pane may paint a run failure only when the DAEMON adjudicated the run.
 * Every other stream error leaves the run UNRESOLVED, and it stays unresolved
 * until the run itself answers.
 *
 * An unadjudicated error says nothing about the run, which is usually still
 * going: a stream that fails when it OPENS fails at the start of a turn that
 * then runs for seconds or minutes and normally succeeds. The generic
 * disconnect belongs to this class too, even though it carries a code — that
 * code is this client's own word for "my reconnect budget ran out", not the
 * daemon's word for what happened to the run.
 *
 * Everything else is a verdict and keeps the failure card: the daemon's own
 * `error` frame, with or without a code, and the classification
 * `markErrorRunFailure` stamps from a terminal the client read.
 */
export function isUnadjudicatedStreamFailure(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  return (err as Record<string, unknown>)[UNADJUDICATED_STREAM_FAILURE] === true;
}

/**
 * The row a run keeps while a stream failure leaves it UNRESOLVED.
 *
 * A pane that only stops PAINTING the failure has closed one carrier and left
 * the other open. `consumeDaemonRun` reports `failed` through `onRunStatus`
 * before it surfaces an error it minted out of a connection IT could not keep
 * (`providers/daemon.ts`), so the row itself still carries a terminal the daemon
 * never declared — and that terminal is both the second thing `ChatPane` paints
 * a failure from and the reason its checking notice would not show, because the
 * notice is keyed to an ACTIVE row.
 *
 * So an unadjudicated stream failure takes that terminal back. The row returns
 * to `daemonDeclared` — the last status the DAEMON itself declared for the run —
 * and drops the disconnect-time `endedAt` when that status is active, because
 * nothing has ended. Only the run's own terminal moves it again.
 */
export function withUnresolvedRunStatus<T extends ChatMessage>(
  message: T,
  daemonDeclared: ChatMessage['runStatus'],
): T {
  const endedAt = isActiveRunStatus(daemonDeclared) ? undefined : message.endedAt;
  if (message.runStatus === daemonDeclared && message.endedAt === endedAt) return message;
  return { ...message, runStatus: daemonDeclared, endedAt };
}

/**
 * What a pane tells `ChatPane` while one of its runs is unresolved.
 *
 * `unreachable` turns true once the follow has exhausted its status probes AND
 * its fallback conversation read — the daemon is answering nothing at all —
 * which changes the notice's wording and offers a manual re-check. It never
 * becomes a failure: only the run's own `failed` does that.
 *
 * ONE UNRESOLVED CLASS NEVER ESCALATES: the generic disconnect. No pane follows
 * it — `isGenericDaemonDisconnect` keeps its own recovery, the reconnect budget
 * plus `attachRecoverableRuns` re-querying on the next tick — and `unreachable`
 * only ever turns over inside the follow. Its notice therefore keeps the
 * ordinary wording for as long as the run is unresolved, and offers no manual
 * re-check, because the thing that would answer one is already running. Moving
 * that class onto this follow would change the semantics 1F.1/1G.1 rely on, so
 * it is a decision for whoever revisits the reattach path, not a gap to patch
 * here.
 */
export interface RunCheckState {
  runId: string;
  unreachable: boolean;
}

/**
 * What the checking notice says next, given what the daemon just did.
 *
 * The wording follows the DAEMON's answers, not the run's. `unreachable` turns
 * on only where the follow has run out of answers — the status probes exhausted
 * their bound AND the fallback conversation read said nothing either — and off
 * again the moment anything answers at all, however long the run then takes. A
 * daemon that is replying to every probe must never be described as silent, and
 * the "Check again" action it offers must not stand once there is nothing left
 * to check again.
 *
 * Returns `current` unchanged when it belongs to another run or already says
 * the right thing, so a pane can call it on every probe.
 */
export function runCheckWithDaemonReachability<T extends RunCheckState>(
  current: T | null,
  runId: string,
  reachable: boolean,
): T | null {
  if (!current || current.runId !== runId) return current;
  if (current.unreachable !== reachable) return current;
  return { ...current, unreachable: !reachable };
}

/**
 * How long a pane waits before its FIRST re-check of a failure it only
 * INFERRED from a dead stream.
 *
 * The pane's own save of the failed row is still in flight at that moment, and
 * the daemon holds a stored terminal against it
 * (`holdTerminalRunStatusOnMessageWrite`). Reading a beat later means the answer
 * is the row the daemon settled on rather than a race with the pane's own write.
 * It is the delay `scheduleConversationMessageRefresh` already uses for the
 * terminals a client does receive.
 */
export const RUN_FAILURE_RECHECK_DELAY_MS = 150;

/** Spacing between later re-checks; matches the generic-disconnect backoff. */
export const RUN_FAILURE_RECHECK_INTERVAL_MS = 3000;

/**
 * How many CONSECUTIVE status probes may answer nothing before a pane stops
 * following the run.
 *
 * A probe that answers nothing is a network error or a non-OK response —
 * `fetchChatRunStatus` returns `null` for both — and neither is a verdict on
 * the run. The outage class that makes a pane infer a failure at all is exactly
 * the one that produces these, so a small bound abandons the recovery for the
 * same reason it was needed: at `RUN_FAILURE_RECHECK_INTERVAL_MS` spacing,
 * three misses are a nine-second daemon hiccup.
 *
 * This bound is therefore long — about five minutes of a daemon that never
 * answers, well past the point at which a daemon that came back would already
 * have been seen. An answered probe resets the count, so only an unbroken
 * outage reaches it.
 *
 * Reaching it is NOT the end. It yields `'reconcile'`: fall back to one
 * conversation read, which can retract the failure from the row the daemon
 * settled on even while the run's own status is unreachable. If that read
 * answers nothing either — `listMessages` reports a non-OK response as an empty
 * array, so an outage still running looks the same as a conversation with
 * nothing to say — the pane resets the count and keeps following. The bound is
 * how long an unbroken outage runs BETWEEN fallback reads, not a budget after
 * which an unresolved failure is abandoned.
 */
export const RUN_FAILURE_RECHECK_MAX_MISSES = 100;

export type InferredRunFailureStep = 'settle' | 'retry' | 'reconcile' | 'fail';

/**
 * What a pane does next with a failure it inferred, given the run's own status.
 *
 * The failure is inferred, not reported: the event stream answered non-OK, so
 * the pane never saw a terminal and wrote `failed` on a guess. The run itself is
 * usually still going at that moment — a stream that fails when it OPENS fails
 * at the start of a turn that then runs for seconds or minutes — so a single
 * look decides nothing. The pane follows the run instead, and the run is what
 * bounds it:
 *
 *  - a non-failed terminal SETTLES the question, and it is applied from the
 *    status alone (`applyRunTerminalFromStatus`); the conversation is read
 *    afterwards only to improve the row's content;
 *  - `failed` is the daemon's verdict, and the only thing that may produce a
 *    failure card for this run. A pane that already painted the failure stops
 *    there; a pane still showing the neutral checking state adopts the
 *    daemon's own row so the card carries the daemon's structured facts. A
 *    genuinely failed run is never re-queried for a different answer;
 *  - `queued` / `running` means the answer has not arrived yet — keep following;
 *  - a probe that returns nothing is a miss, not an answer, so it decides
 *    nothing either. Misses are counted consecutively and the pane keeps
 *    following. An unbroken outage of `RUN_FAILURE_RECHECK_MAX_MISSES` probes
 *    yields `'reconcile'`, which is a fallback conversation read rather than a
 *    verdict: a pane whose read answers nothing says so in the notice and
 *    follows again. Only `'fail'` ends the following, and only the run's own
 *    `failed` produces it.
 */
export function nextInferredRunFailureStep(
  status: ChatRunStatus | null | undefined,
  misses: number,
): InferredRunFailureStep {
  if (status === 'succeeded' || status === 'canceled') return 'settle';
  if (status === 'failed') return 'fail';
  if (status === 'queued' || status === 'running') return 'retry';
  return misses < RUN_FAILURE_RECHECK_MAX_MISSES ? 'retry' : 'reconcile';
}

/**
 * A mounted chat client may not keep showing a failure the run itself retracted.
 *
 * The client cannot tell a dead run from a dead connection, so a dropped SSE
 * stream makes it mark its own assistant row `failed` and raise the chat pane's
 * run-recovery alert. The run usually survives and reaches its `end: succeeded`
 * terminal event, after which the daemon repairs the stored row
 * (`followRunTerminalOnMessage`). Both halves of that terminal reach a client
 * already on screen: the run status itself, through the reattached stream, and
 * the repaired row, through the conversation refresh every terminal handler
 * schedules (`scheduleConversationMessageRefresh` in `ProjectView.tsx`, called
 * from the reattach `onDone`/`onError` and from the live `onDone`/`onRunStatus`).
 *
 * Each of those updates the row. Neither used to touch the pane's own run-error
 * string, and `ChatPane` paints "Task failed" from EITHER carrier
 * (`displayError`): the row, read through `isRetryableAssistantTerminalFailure`,
 * or that string. Reconciling only the row leaves the alert on screen for a
 * succeeded turn until a page reload.
 *
 * This is the invariant that closes it: whatever moves an assistant row out of
 * terminal failure retracts the failure the pane is still showing, and both go
 * in the same update. `retractsRunFailure` judges one row against the status
 * arriving for it; `retractsStaleRunFailure` judges the rows a conversation
 * refresh brings in. Rows that stay failed keep their alert.
 *
 * A client can also reach that point WITHOUT any terminal: when the run's
 * event stream answers non-OK, `consumeDaemonRun` surfaces a plain
 * `daemon <status>` error and returns (`providers/daemon.ts`), so no terminal
 * event ever arrives and no handler above can fire. Neither client paints a
 * failure for that — `isUnadjudicatedStreamFailure` above says the daemon has
 * not adjudicated the run, so the row keeps its last active status and the pane
 * shows a neutral checking notice. Both then follow the run itself: see
 * `nextInferredRunFailureStep` below for the rule and what bounds it, and
 * `applyRunTerminalFromStatus` for the terminal applied from the status alone.
 * The call sites are `reconcileInferredRunFailure` in `ProjectView.tsx` and
 * `scheduleRunFailureRecheck` in `workspace/useConversationChat.ts`.
 *
 * What this does NOT promise: the pane's error string is a single slot shared
 * with errors no row raised (a conversation-load failure, an audio error). One
 * of those, raised in the window between the row failing and the reconciliation
 * arriving, is cleared along with the run failure. Scoping the slot per source
 * is the fix for that, and is not attempted here.
 */
export function retractsRunFailure(
  shown: ChatMessage | undefined,
  arriving: ChatMessage['runStatus'],
): boolean {
  if (!shown || !isFailedAssistantRow(shown)) return false;
  return !isFailedAssistantRow({ ...shown, runStatus: arriving });
}

/**
 * The conversation-refresh form of the invariant above.
 *
 * `incoming` is judged as `mergeServerMessageWithLocal` merges it: an incoming
 * row with no `runStatus` of its own leaves the shown row's status standing and
 * therefore retracts nothing.
 */
export function retractsStaleRunFailure(
  shown: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): boolean {
  const failedIds = new Set(
    shown.filter(isFailedAssistantRow).map((message) => message.id),
  );
  if (failedIds.size === 0) return false;
  return incoming.some(
    (message) =>
      failedIds.has(message.id) &&
      message.runStatus !== undefined &&
      !isFailedAssistantRow(message),
  );
}

/** A run's own status snapshot, as `fetchChatRunStatus` reports it. */
export interface InferredRunTerminal {
  status: ChatRunStatus;
  /** Daemon clock for the status; the authoritative `endedAt` for the row. */
  updatedAt?: number;
}

/**
 * A row this run may still move onto its terminal: one the pane is showing as
 * active — an unresolved stream failure leaves it exactly there — or one
 * carrying a failure the client only inferred.
 */
function acceptsRunTerminal(shown: ChatMessage, arriving: ChatMessage['runStatus']): boolean {
  if (shown.role !== 'assistant') return false;
  if (isActiveRunStatus(shown.runStatus)) return true;
  return retractsRunFailure(shown, arriving);
}

/**
 * An incoming conversation answers the question a checking notice is asking
 * when it carries this run's row on a terminal of its own.
 *
 * The unresolved row on screen is still ACTIVE, so `retractsStaleRunFailure`
 * has no failure to judge and would ignore a read that in fact settled the run.
 */
export function conversationAnswersRunCheck(
  runId: string,
  incoming: readonly ChatMessage[],
): boolean {
  return incoming.some(
    (message) =>
      message.role === 'assistant'
      && message.runId === runId
      && (message.runStatus === 'succeeded'
        || message.runStatus === 'failed'
        || message.runStatus === 'canceled'),
  );
}

/**
 * The status-first half of the invariant: the run's OWN terminal settles the
 * row, before anything is read from the conversation.
 *
 * A pane following an inferred failure learns the truth in two steps — the
 * run's status, then the conversation the daemon repaired. Only the first is
 * authoritative about whether the failure was real, and only the first is
 * distinguishable from silence: `listMessages` reports a non-OK response and a
 * thrown fetch alike as an empty array (`state/projects.ts`), so a merge that
 * FAILED reads the same as a conversation with nothing to say. Applying the
 * status first leaves the merge only able to IMPROVE the row's content; a merge
 * that fails can no longer leave "Task failed" painted over a turn the run
 * itself reports as succeeded.
 *
 * Returns the rows to show, or `null` when no row on screen is still waiting
 * for this run. The pane's error carrier is NOT keyed on that answer: it is cleared
 * on the run's terminal either way, because the two carriers `ChatPane` paints
 * from can come apart. Anything that reloads the conversation replaces the local
 * row with the daemon's already-repaired one while the error string stays, and a
 * carrier with no row left to name it would otherwise paint "Task failed"
 * forever (see `retractsRunFailure`).
 */
export function applyRunTerminalFromStatus(
  shown: readonly ChatMessage[],
  runId: string,
  run: InferredRunTerminal | null | undefined,
): ChatMessage[] | null {
  if (!run) return null;
  if (run.status !== 'succeeded' && run.status !== 'canceled') return null;
  let applied = false;
  const next = shown.map((message) => {
    if (message.runId !== runId || !acceptsRunTerminal(message, run.status)) return message;
    applied = true;
    return { ...message, runStatus: run.status, endedAt: run.updatedAt ?? message.endedAt };
  });
  return applied ? next : null;
}
