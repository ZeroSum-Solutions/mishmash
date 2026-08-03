import { describe, expect, it } from 'vitest';
import {
  STORYBOARD_MOOD_DRAFT_STATUSES,
  STORYBOARD_SHOT_STATUSES,
  isStoryboardMoodDraftStatus,
  isStoryboardShotStatus,
} from '../src/api/storyboard';

/**
 * OBS-1: storyboards carry two status vocabularies that differ only in their
 * first member — shots start life as `draft` (an editable plan row), mood
 * drafts as `idle` (a prompt not yet dispatched). A QA seeder that posted
 * `idle` for a shot burned a run on exactly this trap, because every
 * consumer hand-listed the values. The contract now owns one runtime list
 * per vocabulary; validators must derive from these, never re-list them.
 */
describe('storyboard status vocabularies', () => {
  it('exports the shot vocabulary, draft-first', () => {
    expect(STORYBOARD_SHOT_STATUSES).toEqual(['draft', 'rendering', 'done', 'failed']);
  });

  it('exports the mood-draft vocabulary, idle-first', () => {
    expect(STORYBOARD_MOOD_DRAFT_STATUSES).toEqual(['idle', 'rendering', 'done', 'failed']);
  });

  it('guards reject the OTHER vocabulary’s first member', () => {
    // The exact confusion that cost the seeder a run, pinned in both
    // directions.
    expect(isStoryboardShotStatus('idle')).toBe(false);
    expect(isStoryboardShotStatus('draft')).toBe(true);
    expect(isStoryboardMoodDraftStatus('draft')).toBe(false);
    expect(isStoryboardMoodDraftStatus('idle')).toBe(true);
  });

  it('guards reject non-status junk', () => {
    for (const junk of ['', 'DONE', 'pending', 42, null, undefined]) {
      expect(isStoryboardShotStatus(junk)).toBe(false);
      expect(isStoryboardMoodDraftStatus(junk)).toBe(false);
    }
  });
});
