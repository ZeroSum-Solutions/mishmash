import type { ChatMessage } from '../types';
import { isRetryableAssistantTerminalFailure } from './design-delivery';

function isFailedAssistantRow(message: ChatMessage): boolean {
  return message.role === 'assistant' && isRetryableAssistantTerminalFailure(message);
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
