// Pure enablement/gating logic for one storyboard shot card. Kept separate
// from ShotCard.tsx so the state machine (start -> derive -> render
// enablement, motion-prompt gating) is directly testable without rendering
// the full component tree.

import type { StoryboardShot } from '@open-design/contracts';

export interface ShotEditorState {
  hasStartFrame: boolean;
  hasEndFrame: boolean;
  /** True when the previous shot (by order) has an end frame this shot can reuse as its own start frame. */
  canUsePreviousEndFrame: boolean;
  /** "Derive from start frame" is only meaningful once a start frame exists to edit. */
  canDeriveEndFrame: boolean;
  /** "Iterate" edits the CURRENT start frame in place; needs one to exist. */
  canIterateStartFrame: boolean;
  motionPromptTrimmed: string;
  hasMotionPrompt: boolean;
  /** Render requires a start frame and a non-empty motion prompt; a 'done' shot can still re-render from here — the same button doubles as retry. */
  canRender: boolean;
  isRendering: boolean;
  renderDisabledReason: string | null;
}

export function computeShotEditorState(
  shot: Pick<StoryboardShot, 'startFrame' | 'endFrame' | 'motionPrompt' | 'status'>,
  previousShot: Pick<StoryboardShot, 'endFrame'> | null,
): ShotEditorState {
  const hasStartFrame = Boolean(shot.startFrame?.path);
  const hasEndFrame = Boolean(shot.endFrame?.path);
  const canUsePreviousEndFrame = !hasStartFrame && Boolean(previousShot?.endFrame?.path);
  const motionPromptTrimmed = (shot.motionPrompt ?? '').trim();
  const hasMotionPrompt = motionPromptTrimmed.length > 0;
  const isRendering = shot.status === 'rendering';

  let renderDisabledReason: string | null = null;
  if (!hasStartFrame) renderDisabledReason = 'Add a start frame first.';
  else if (!hasMotionPrompt) renderDisabledReason = 'Describe the motion first.';
  else if (isRendering) renderDisabledReason = 'Already rendering.';

  return {
    hasStartFrame,
    hasEndFrame,
    canUsePreviousEndFrame,
    canDeriveEndFrame: hasStartFrame,
    canIterateStartFrame: hasStartFrame,
    motionPromptTrimmed,
    hasMotionPrompt,
    canRender: renderDisabledReason === null,
    isRendering,
    renderDisabledReason,
  };
}

/**
 * At-a-glance generation state for a shot ROW (PRD C4 outcome 3: "visible
 * generation states... readable at a glance on every shot row"). The
 * contract's StoryboardShotStatus only has draft/rendering/done/failed — no
 * dedicated "queued" value — so the brief window between firing a render (or
 * frame-generation) request and the status actually flipping to 'rendering'
 * is inferred from the caller's own busy flag (StoryboardEditor's
 * busyShotIds) rather than a status the server tracks. 'idle' covers a shot
 * that hasn't been touched yet — no badge is shown for it on the row.
 */
export type ShotDisplayStatus = 'idle' | 'queued' | 'generating' | 'done' | 'failed';

export function computeShotDisplayStatus(
  shot: Pick<StoryboardShot, 'status'>,
  busy: boolean,
): ShotDisplayStatus {
  if (shot.status === 'failed') return 'failed';
  if (shot.status === 'done') return 'done';
  if (shot.status === 'rendering') return 'generating';
  if (busy) return 'queued';
  return 'idle';
}

/**
 * Render/Retry button LABEL mode, shared by ShotRow.tsx and ShotCard.tsx so
 * the two never drift on when a shot's primary action reads "Render" vs.
 * "Rendering…" vs. "Retry" (react review R5). Deliberately returns a
 * discriminant, not a translated string — this file stays i18n-free (see
 * the module doc comment); callers own the `t()` lookup.
 *
 * Never returns a mode for a disabled retry: a failed shot that still lacks
 * a start frame/motion prompt (canRender false) is `'render'` here, same as
 * an untouched shot — ShotRow is the one place that turns THAT combination
 * into an enabled "Fix in details" CTA instead of a disabled Retry button
 * (react review R4); ShotCard has nowhere else to send the user, so it just
 * shows the ordinary disabled Render button with its existing
 * renderDisabledReason tooltip.
 */
export type RenderButtonMode = 'render' | 'rendering' | 'retry';

export function computeRenderButtonMode(
  state: Pick<ShotEditorState, 'canRender' | 'isRendering'>,
  displayStatus: ShotDisplayStatus,
): RenderButtonMode {
  if (state.isRendering) return 'rendering';
  if (displayStatus === 'failed' && state.canRender) return 'retry';
  return 'render';
}
