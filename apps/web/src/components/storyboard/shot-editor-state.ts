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
