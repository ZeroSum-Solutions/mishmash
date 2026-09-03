/**
 * Canonical "what did this design turn deliver?" decision.
 *
 * ONE definition, shared by the web chat's post-run finalization
 * (`resolveDesignDeliveryOutcome` in `apps/web/src/runtime/design-delivery.ts`)
 * and the daemon's own terminal classification for a turn no web client was
 * watching (`apps/daemon/src/runtimes/run-delivery-classification.ts`). Each
 * side reduces its own event shape to the evidence below; only the decision
 * lives here, so the two surfaces cannot drift into disagreeing about whether
 * the same turn delivered work.
 *
 * A successful agent process is not necessarily a delivered design. Design mode
 * is artifact-first, but clarification and explicitly unfinished turns are valid
 * intermediate outcomes, and Chat and Plan remain text-first and must never be
 * failed merely because they did not write a project file.
 *
 * A zero-file success is only a missing deliverable when the turn attempted to
 * write project files (or an artifact save failed). A turn that never tried to
 * write and answered with substantive text is a report-only result — image
 * analysis, report-only audits, and shell cleanups end exactly this way — and
 * must not be downgraded to ARTIFACT_NOT_FOUND. The known cost: an agent that
 * merely claims completion without ever calling a write tool now passes as text;
 * the text itself makes that visible to the user.
 */
import type { ChatRunStatus, ChatSessionMode } from './chat.js';
import type { ProjectFile } from './files.js';

export type DesignDeliveryOutcome =
  | 'not_required'
  | 'awaiting_input'
  | 'delivered'
  | 'report_only'
  | 'no_result'
  | 'delivery_failed';

/**
 * Every fact the delivery decision reads, already reduced from whichever event
 * shape the caller holds.
 */
export interface DesignDeliveryEvidence {
  sessionMode: ChatSessionMode | null | undefined;
  runStatus: ChatRunStatus | null | undefined;
  /** The assistant's answer text for the turn. */
  content: string;
  /** The turn's last declared task list still has unfinished work. */
  hasUnfinishedTodos: boolean;
  /**
   * How many project files the turn handed the user: files that appeared, files
   * it rewrote in place, and trace objects it touched. Only the zero/non-zero
   * distinction is read.
   */
  deliveredFileCount: number;
  /** A live artifact was created or refreshed during the turn. */
  hasLiveArtifactDelivery: boolean;
  /** A daemon-managed preview server came up during the turn (issue #38): the
   *  deliverable is the live URL, not a file. */
  hasPreviewServerStart: boolean;
  /** The host saved the turn's inline artifact into the project. */
  persistenceSucceeded: boolean;
  /** The host tried to save the turn's inline artifact and failed. */
  persistenceFailed: boolean;
  /** The turn called a write or edit tool, whether or not it succeeded. */
  attemptedFileWrite: boolean;
}

/**
 * The turn stopped to ask the user something. `<question-form>` is the single
 * clarification mechanism (root `AGENTS.md`, "Asking the user questions"), so an
 * emitted form marker is what separates an intermediate turn from a finished one.
 */
export function turnAsksForUserInput(content: string): boolean {
  return /<(?:question-form|ask-question)\b/i.test(content);
}

/**
 * Whether a project file may be attributed to a run implicitly — by pre/post
 * file-list diff or by write timing — rather than because the run named it.
 *
 * User-created sketches change during a run without being assistant output, so
 * they never count. Shared so the web finalization and the daemon's own
 * classification agree about what a turn is allowed to claim it produced.
 */
export function isImplicitProducedFileCandidate(
  file: Pick<ProjectFile, 'name'> & { path?: string | undefined },
): boolean {
  const lowerPath = (file.path ?? file.name).toLowerCase();
  return !lowerPath.endsWith('.sketch.json');
}

/**
 * Delivery evidence is every way a turn can hand the user something: a file that
 * appeared, a file that was rewritten in place, a saved artifact, a live
 * artifact, or a preview server that is answering HTTP.
 */
export function resolveDesignDeliveryOutcomeFromEvidence(
  evidence: DesignDeliveryEvidence,
): DesignDeliveryOutcome {
  if (evidence.sessionMode !== 'design' || evidence.runStatus !== 'succeeded') {
    return 'not_required';
  }
  if (turnAsksForUserInput(evidence.content) || evidence.hasUnfinishedTodos) {
    return 'awaiting_input';
  }
  if (
    evidence.deliveredFileCount > 0 ||
    evidence.persistenceSucceeded ||
    evidence.hasLiveArtifactDelivery ||
    evidence.hasPreviewServerStart
  ) {
    return 'delivered';
  }
  if (evidence.persistenceFailed) return 'delivery_failed';
  if (!evidence.attemptedFileWrite && evidence.content.trim().length > 0) {
    return 'report_only';
  }
  return 'no_result';
}
