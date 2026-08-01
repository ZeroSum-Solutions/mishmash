// Canned motion-prompt presets for the shots empty state's "start from a
// template" entry point (PRD C4 outcome 2). Deliberately tiny and
// client-only: selecting one just pre-fills a new shot's motionPrompt via
// the same appendShotIfAbsent mutator every other "add a shot" path already
// uses (StoryboardEditor.tsx) — no new daemon/provider surface.

import type { Dict } from '../../i18n/types';

export interface ShotTemplate {
  id: string;
  labelKey: keyof Dict;
  motionPromptKey: keyof Dict;
}

export const SHOT_TEMPLATES: ShotTemplate[] = [
  { id: 'pan-left', labelKey: 'storyboard.template.panLeft', motionPromptKey: 'storyboard.template.panLeftPrompt' },
  { id: 'slow-zoom-in', labelKey: 'storyboard.template.slowZoomIn', motionPromptKey: 'storyboard.template.slowZoomInPrompt' },
];
