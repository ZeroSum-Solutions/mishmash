/**
 * INV-7.4 (wave 7, spec-audit-r2, W7-R2-01 — binding, Sol's exact wording):
 *
 * "For each terminal run previously observed active, sound and desktop
 * decisions are independent: enabled sound plays exactly once regardless
 * of focus or desktop permission; enabled desktop with granted permission
 * shows exactly once when the document is hidden/unfocused or the run
 * failed; focused success, denied/disabled desktop, and replay show no
 * desktop notification."
 *
 * `decideCompletionNotifications` is the pure decision this invariant
 * describes. It reads no DOM state itself — the caller
 * (`ProjectView.notifyCompletedRun`, `ProjectView.tsx:2208-2252`) resolves
 * every input (settings, permission, visibility/focus, and the two
 * dedupe flags it already tracks in `activeCompletionNotificationRunsRef`
 * / `completedNotificationRunsRef`) and calls this once per terminal run.
 * Keeping the decision pure and side-effect-free is what makes the seven
 * cases below independently testable without mounting the component.
 */

export type TerminalRunStatus = 'succeeded' | 'failed';

export interface NotificationDecisionInput {
  /** The run's terminal status. */
  status: TerminalRunStatus;
  /** `AppConfig.notifications.soundEnabled` — the completion-sound mute. */
  soundEnabled: boolean;
  /** `AppConfig.notifications.desktopEnabled` — the desktop-banner opt-in. */
  desktopEnabled: boolean;
  /** `Notification.permission`, or `'unsupported'` when the API is absent. */
  desktopPermission: NotificationPermission | 'unsupported';
  /** `document.hidden` at decision time. */
  documentHidden: boolean;
  /** `document.hasFocus()` at decision time. */
  documentFocused: boolean;
  /** This run id was previously observed with an active (`queued`/`running`)
   * status — the guard that keeps a stale, already-finished run from
   * notifying on load. */
  wasPreviouslyActive: boolean;
  /** This run id already produced a completion notification for this
   * terminal transition (the replay guard). */
  alreadyNotified: boolean;
}

export interface NotificationDecision {
  playSound: boolean;
  showDesktop: boolean;
}

export function decideCompletionNotifications(
  input: NotificationDecisionInput,
): NotificationDecision {
  if (!input.wasPreviouslyActive || input.alreadyNotified) {
    return { playSound: false, showDesktop: false };
  }

  const playSound = input.soundEnabled;

  // Successes only interrupt when the user is away from the tab; failures
  // alert regardless — losing a long agent run silently is worse than a
  // small interruption when the page is in focus (the deliberate clause
  // preserved from `ProjectView.tsx:2229-2231`).
  const visibilityQualifies =
    input.status === 'failed' || input.documentHidden || !input.documentFocused;
  const showDesktop =
    input.desktopEnabled && input.desktopPermission === 'granted' && visibilityQualifies;

  return { playSound, showDesktop };
}
