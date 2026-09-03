import type { ChatRunStatus } from '@open-design/contracts';
import type { ChatMessage } from '../types';
import { isRetryableAssistantTerminalFailure } from './design-delivery';

function isFailedAssistantRow(message: ChatMessage): boolean {
  return message.role === 'assistant' && isRetryableAssistantTerminalFailure(message);
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

/** How many status probes may return nothing before the pane gives up. */
export const RUN_FAILURE_RECHECK_MAX_MISSES = 3;

export type InferredRunFailureStep = 'retract' | 'retry' | 'stop';

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
 *  - a non-failed terminal is the retraction: read the conversation and let
 *    `retractsStaleRunFailure` judge the rows the daemon settled on;
 *  - `failed` agrees with the row on screen, so the pane stops at once and the
 *    alert stays. A genuinely failed run is never re-queried;
 *  - `queued` / `running` means the answer has not arrived yet — keep following;
 *  - a probe that returns nothing is a miss, not an answer. A few are tolerated
 *    (`RUN_FAILURE_RECHECK_MAX_MISSES`) so a hiccup does not end the recovery,
 *    and then the pane stops rather than polling a daemon that cannot answer.
 */
export function nextInferredRunFailureStep(
  status: ChatRunStatus | null | undefined,
  misses: number,
): InferredRunFailureStep {
  if (status === 'succeeded' || status === 'canceled') return 'retract';
  if (status === 'failed') return 'stop';
  if (status === 'queued' || status === 'running') return 'retry';
  return misses < RUN_FAILURE_RECHECK_MAX_MISSES ? 'retry' : 'stop';
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
 * A client can also reach that failure WITHOUT any terminal: when the run's
 * event stream answers non-OK, `consumeDaemonRun` surfaces a plain
 * `daemon <status>` error and returns (`providers/daemon.ts`), so no terminal
 * event ever arrives and no handler above can fire. The live send loop then
 * seals the run without a refresh, and Side Chat has no refresh at all. Both
 * follow the run itself instead — see `nextInferredRunFailureStep` below for
 * the rule and what bounds it — and read the conversation only once the run
 * reports a non-failed terminal, applying it when `retractsStaleRunFailure`
 * says it retracts the failure on screen. The call sites are
 * `reconcileInferredRunFailure` in `ProjectView.tsx` and
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
