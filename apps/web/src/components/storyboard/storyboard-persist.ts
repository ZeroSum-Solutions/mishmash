// Pure, testable core for storyboard mutation + persistence.
//
// StoryboardEditor's render-poll chains (waitForMediaTask) run 15-25 minutes.
// Expressing every edit as a StoryboardMutator — a pure (prev: Storyboard) =>
// Storyboard function — instead of a captured Storyboard snapshot means a
// mutation queued minutes into one of those chains always composes onto
// whatever the LATEST doc turns out to be, never a stale closure. Pairing
// that with PatchStoryboardRequest.expectedUpdatedAt lets a stale PATCH fail
// loudly (409) instead of silently last-write-wins clobbering concurrent
// edits to OTHER shots made in the meantime — this module reapplies the same
// mutator to the server's current doc and retries once.
//
// Kept dependency-free of the network/React so it's directly unit-testable:
// StoryboardEditor.tsx supplies `patch` (registry.ts's patchStoryboard).

import type { Storyboard, StoryboardShot } from '@open-design/contracts';
import type { StoryboardApiResult } from '../../providers/registry';

export type StoryboardMutator = (prev: Storyboard) => Storyboard;

/**
 * Appends `shot` onto `shots` unless a shot with the same id is already
 * present, in which case `shots` is returned unchanged (same reference).
 * Every append-style shot mutator in StoryboardEditor.tsx (add shot,
 * duplicate shot, add shots from images) is built on this instead of an
 * unconditional `[...shots, shot]` push: persistStoryboardMutation's 409
 * retry (below) reapplies the SAME mutator to whatever the server's current
 * doc turns out to be, and if that doc already contains the shot (e.g. a
 * prior attempt at this exact append already reached the server despite
 * this client observing a 409), an unconditional append would duplicate it.
 */
export function appendShotIfAbsent(shots: StoryboardShot[], shot: StoryboardShot): StoryboardShot[] {
  if (shots.some((s) => s.id === shot.id)) return shots;
  return [...shots, shot];
}

export type StoryboardPatchFn = (
  id: string,
  patch: {
    title?: string;
    ratio?: string;
    moodDrafts?: Storyboard['moodDrafts'];
    shots?: Storyboard['shots'];
    expectedUpdatedAt?: string;
  },
) => Promise<StoryboardApiResult<Storyboard>>;

function patchFieldsFor(doc: Storyboard) {
  return { title: doc.title, ratio: doc.ratio, moodDrafts: doc.moodDrafts, shots: doc.shots };
}

/**
 * Applies `mutator` to `base`, PATCHes the result with `expectedUpdatedAt:
 * base.updatedAt`, and — on a 409 (the server's doc moved since `base` was
 * read) — reapplies the SAME mutator to the conflict body's current doc and
 * retries once. Returns whichever attempt the server accepted (or the final
 * failure); never silently drops the concurrent edit that caused the 409.
 */
export async function persistStoryboardMutation(
  id: string,
  base: Storyboard,
  mutator: StoryboardMutator,
  patch: StoryboardPatchFn,
): Promise<StoryboardApiResult<Storyboard>> {
  const next = mutator(base);
  const first = await patch(id, { ...patchFieldsFor(next), expectedUpdatedAt: base.updatedAt });
  if (first.ok || first.status !== 409 || !first.conflict) return first;

  const conflictDoc = first.conflict;
  const retried = mutator(conflictDoc);
  return patch(id, { ...patchFieldsFor(retried), expectedUpdatedAt: conflictDoc.updatedAt });
}
