import type { ChatSessionMode } from '@open-design/contracts';
import { isImplicitProducedFileCandidate } from '../produced-files';
import type { AgentEvent, ChatMessage, ProjectFile } from '../types';
import { hasFileWriteToolUse } from './file-ops';
import { unfinishedTodosFromEvents } from './todos';

export type DesignDeliveryOutcome =
  | 'not_required'
  | 'awaiting_input'
  | 'delivered'
  | 'report_only'
  | 'no_result'
  | 'delivery_failed';

export interface DesignDeliveryInput {
  sessionMode: ChatSessionMode | null | undefined;
  runStatus: ChatMessage['runStatus'];
  content: string;
  events: AgentEvent[] | undefined;
  producedFileCount: number;
  traceObjectFileCount: number;
  /** Project files rewritten during the turn; see `countFilesModifiedDuringTurn`. */
  modifiedFileCount?: number;
  persistenceSucceeded?: boolean;
  persistenceFailed?: boolean;
}

/**
 * Counts the project files this turn wrote over.
 *
 * The pre-turn snapshot records file NAMES only, so a diff against it sees a
 * file that appeared and nothing else. A turn that rewrote `assets/hero.jpg`
 * through `cp`, `magick`, or `ffmpeg` changes no name and would otherwise read
 * as an empty turn. The invariant that closes that gap: a project file whose
 * mtime is at or after the moment the snapshot was taken was written during the
 * turn. Without a snapshot timestamp there is no boundary to judge against, so
 * the count is zero rather than a guess.
 *
 * Files that are excluded from implicit attribution stay excluded here, so this
 * count agrees with `computeProducedFiles` and `computeTraceObjectFiles` about
 * what may be attributed to a run.
 */
export function countFilesModifiedDuringTurn(
  files: readonly ProjectFile[] | undefined,
  turnStartedAt: number | null | undefined,
): number {
  if (!files || typeof turnStartedAt !== 'number' || !Number.isFinite(turnStartedAt)) return 0;
  let count = 0;
  for (const file of files) {
    if (file.type === 'dir') continue;
    if (!isImplicitProducedFileCandidate(file)) continue;
    if (Number.isFinite(file.mtime) && file.mtime >= turnStartedAt) count += 1;
  }
  return count;
}

/**
 * A cancellation nobody asked for.
 *
 * The daemon draws the line between the two cancellations for us, and it draws
 * it on the message rather than on the run status. A Stop the user pressed is
 * classified `user_cancel`, and `persistRunFailureClassification`
 * (`apps/daemon/src/runtimes/chat-run-messages.ts`) deliberately refuses to give
 * that message an error event it did not already have, because reporting the
 * user's own action back to them as a failure is the wrong answer. A turn the
 * daemon's own shutdown ended is classified `process_exit` / `interrupted` and
 * DOES carry that event.
 *
 * So a classified error event on a canceled row means the turn was taken from
 * the user — and reading the event rather than the status is what keeps a
 * deliberate Stop silent.
 */
function isUnrequestedCancellation(
  message: Pick<ChatMessage, 'runStatus' | 'events'>,
): boolean {
  if (message.runStatus !== 'canceled') return false;
  return (message.events ?? []).some(
    (event) =>
      event.kind === 'status'
      && event.label === 'error'
      && typeof event.failureDetail === 'string'
      && event.failureDetail.length > 0
      && event.failureDetail !== 'user_cancelled',
  );
}

/**
 * Delivery failures retain the agent-process `succeeded` status, but they are
 * terminal user-facing failures and must follow the same retry path as a
 * failed process run. So does a turn the daemon ended without being asked —
 * see `isUnrequestedCancellation` above: it owes the user the same named cause
 * and the same recovery as any other failure, because the user did not do it
 * and has no other way to learn why their turn stopped.
 */
export function isRetryableAssistantTerminalFailure(
  message: Pick<ChatMessage, 'runStatus' | 'resultDeliveryState' | 'events'>,
): boolean {
  return (
    message.runStatus === 'failed' ||
    message.resultDeliveryState === 'no_result' ||
    message.resultDeliveryState === 'delivery_failed' ||
    isUnrequestedCancellation(message)
  );
}

function asksForUserInput(content: string): boolean {
  return /<(?:question-form|ask-question)\b/i.test(content);
}

function isIntermediateDesignTurn(
  content: string,
  events: AgentEvent[] | undefined,
): boolean {
  return asksForUserInput(content) || unfinishedTodosFromEvents(events).length > 0;
}

/**
 * `od preview start --project <id> …` — the only sanctioned way for an agent to
 * start a dev server (`apps/daemon/src/prompts/system.ts`). The daemon prompt
 * spells the invocation `"$OD_NODE_BIN" "$OD_BIN" preview start`, so the program
 * name reaches the event log unexpanded and cannot be matched on; the required
 * `--project` flag is what separates a real invocation from prose.
 */
const PREVIEW_START_COMMAND = /(?:^|[\s;&|"'`(])preview\s+start(?:$|[\s;&|"'`])/;

function isPreviewStartCommand(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const command = (input as { command?: unknown }).command;
  if (typeof command !== 'string') return false;
  return PREVIEW_START_COMMAND.test(command) && /(?:^|\s)--project(?:=|\s)/.test(command);
}

/**
 * A daemon-managed preview server (issue #38) is a delivered result in its own
 * right: the deliverable the user asked for is the live URL, not a file. The
 * start command returns only after the port verifiably answers HTTP, so a
 * non-error tool result is proof the server is up.
 */
function hasPreviewServerStart(events: AgentEvent[] | undefined): boolean {
  const startToolUseIds = new Set<string>();
  for (const event of events ?? []) {
    if (event.kind !== 'tool_use' || event.name !== 'Bash') continue;
    if (isPreviewStartCommand(event.input)) startToolUseIds.add(event.id);
  }
  if (startToolUseIds.size === 0) return false;
  return (events ?? []).some(
    (event) =>
      event.kind === 'tool_result' && !event.isError && startToolUseIds.has(event.toolUseId),
  );
}

function hasLiveArtifactDelivery(events: AgentEvent[] | undefined): boolean {
  return (events ?? []).some(
    (event) =>
      (event.kind === 'live_artifact' && event.action !== 'deleted') ||
      (event.kind === 'live_artifact_refresh' && event.phase === 'succeeded'),
  );
}

/**
 * A successful agent process is not necessarily a delivered design.
 *
 * Design mode is artifact-first, but clarification and explicitly unfinished
 * turns are valid intermediate outcomes. Chat and Plan remain text-first and
 * must never be failed merely because they did not write a project file.
 *
 * A zero-file success is only a missing deliverable when the turn attempted
 * to write project files (or an artifact save failed). A turn that never
 * tried to write and answered with substantive text is a report-only result —
 * image analysis, report-only audits, and shell cleanups end exactly this way —
 * and must not be downgraded to ARTIFACT_NOT_FOUND. The known cost: an agent
 * that merely claims completion without ever calling a write tool now passes as
 * text; the text itself makes that visible to the user.
 *
 * Delivery evidence is every way a turn can hand the user something: a file
 * that appeared, a file that was rewritten in place, a saved artifact, a live
 * artifact, or a preview server that is answering HTTP.
 */
export function resolveDesignDeliveryOutcome(
  input: DesignDeliveryInput,
): DesignDeliveryOutcome {
  if (input.sessionMode !== 'design' || input.runStatus !== 'succeeded') {
    return 'not_required';
  }
  if (isIntermediateDesignTurn(input.content, input.events)) {
    return 'awaiting_input';
  }
  if (
    input.producedFileCount > 0 ||
    input.traceObjectFileCount > 0 ||
    (input.modifiedFileCount ?? 0) > 0 ||
    input.persistenceSucceeded ||
    hasLiveArtifactDelivery(input.events) ||
    hasPreviewServerStart(input.events)
  ) {
    return 'delivered';
  }
  if (input.persistenceFailed) return 'delivery_failed';
  if (!hasFileWriteToolUse(input.events) && input.content.trim().length > 0) {
    return 'report_only';
  }
  return 'no_result';
}

/**
 * The run-status event can arrive before the final project-file refresh. Keep
 * completion feedback quiet during that gap so users never hear "success"
 * immediately before the same turn is downgraded to a delivery failure.
 */
export function designDeliveryVerificationPending(
  message: Pick<
    ChatMessage,
    | 'sessionMode'
    | 'runStatus'
    | 'resultDeliveryState'
    | 'content'
    | 'events'
    | 'producedFiles'
    | 'traceObjectFiles'
  >,
): boolean {
  if (message.sessionMode !== 'design' || message.runStatus !== 'succeeded') return false;
  if (message.resultDeliveryState) return false;
  if (isIntermediateDesignTurn(message.content, message.events)) return false;
  return message.producedFiles === undefined || message.traceObjectFiles === undefined;
}
