import { describe, expect, it, vi } from 'vitest';
import type { Storyboard, StoryboardShot } from '@open-design/contracts';
import {
  persistStoryboardMutation,
  type StoryboardMutator,
} from '../../src/components/storyboard/storyboard-persist';

function shot(overrides: Partial<StoryboardShot> = {}): StoryboardShot {
  return {
    id: 'shot-a',
    order: 0,
    motionPrompt: '',
    model: 'openrouter/bytedance/seedance-2.0:1080p',
    resolution: '1080p',
    durationSec: 5,
    status: 'draft',
    ...overrides,
  };
}

function doc(overrides: Partial<Storyboard> = {}): Storyboard {
  return {
    id: 'sb-1',
    title: 'Test storyboard',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ratio: '16:9',
    moodDrafts: [],
    shots: [shot()],
    ...overrides,
  };
}

describe('persistStoryboardMutation', () => {
  // The red-spec for the stale-closure data-loss bug: a mutation queued
  // minutes into a long-running render-poll chain must compose onto
  // whatever landed on the server in the meantime, not clobber it.
  it('reapplies the mutator to the server current doc on a 409 conflict, without reverting the concurrent edit', async () => {
    const base = doc({ updatedAt: '2026-01-01T00:00:00.000Z' });

    // Another client (or a different concurrent mutation from this same
    // editor) added shot-b between when `base` was read and when this
    // mutation's PATCH reaches the server.
    const concurrentDoc = doc({
      updatedAt: '2026-01-01T00:05:00.000Z',
      shots: [shot(), shot({ id: 'shot-b', order: 1 })],
    });

    const mutator: StoryboardMutator = (prev) => ({
      ...prev,
      shots: prev.shots.map((s) => (s.id === 'shot-a' ? { ...s, motionPrompt: 'the camera pans right' } : s)),
    });

    const patch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 409, message: 'storyboard changed', conflict: concurrentDoc })
      .mockResolvedValueOnce({
        ok: true,
        value: doc({
          updatedAt: '2026-01-01T00:06:00.000Z',
          shots: [shot({ motionPrompt: 'the camera pans right' }), shot({ id: 'shot-b', order: 1 })],
        }),
      });

    const result = await persistStoryboardMutation('sb-1', base, mutator, patch);

    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch.mock.calls[0]![1]).toMatchObject({ expectedUpdatedAt: '2026-01-01T00:00:00.000Z' });

    // Retry: reapplies the SAME mutator to the conflict doc, stamped with
    // ITS updatedAt. shot-b (the concurrent addition) must still be
    // present, and shot-a must carry THIS mutation's change — neither lost.
    const retryCall = patch.mock.calls[1]![1] as { shots: StoryboardShot[]; expectedUpdatedAt: string };
    expect(retryCall.expectedUpdatedAt).toBe('2026-01-01T00:05:00.000Z');
    expect(retryCall.shots.map((s) => s.id)).toEqual(['shot-a', 'shot-b']);
    expect(retryCall.shots.find((s) => s.id === 'shot-a')?.motionPrompt).toBe('the camera pans right');
    expect(retryCall.shots.find((s) => s.id === 'shot-b')).toBeTruthy();

    expect(result.ok).toBe(true);
  });

  it('does not retry when the failure is not a 409 conflict', async () => {
    const base = doc();
    const mutator: StoryboardMutator = (prev) => ({ ...prev, title: 'Renamed' });
    const patch = vi.fn().mockResolvedValue({ ok: false, status: 500, message: 'boom' });

    const result = await persistStoryboardMutation('sb-1', base, mutator, patch);

    expect(patch).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
  });

  it('persists directly (no retry) when the PATCH succeeds on the first try', async () => {
    const base = doc();
    const mutator: StoryboardMutator = (prev) => ({ ...prev, title: 'Renamed' });
    const nextDoc = { ...base, title: 'Renamed', updatedAt: '2026-01-01T00:01:00.000Z' };
    const patch = vi.fn().mockResolvedValue({ ok: true, value: nextDoc });

    const result = await persistStoryboardMutation('sb-1', base, mutator, patch);

    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch.mock.calls[0]![1]).toMatchObject({ title: 'Renamed', expectedUpdatedAt: base.updatedAt });
    expect(result).toEqual({ ok: true, value: nextDoc });
  });
});
