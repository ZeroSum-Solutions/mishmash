// @vitest-environment jsdom
//
// Review finding #16: MoodLane bakes `defaultModelId` into useState ONCE at
// mount (`useState(defaultModelId ?? models[0]?.id ?? '')`). StoryboardSection
// fetches media-provider config asynchronously (fetchMediaProvidersFromDaemon
// in a useEffect) and starts `configured` at `{}` — a fast "New storyboard"
// click can mount StoryboardEditor (and this MoodLane) before that fetch
// resolves, so `defaultModelId` arrives as a LATER prop update once
// `defaultMoodLaneModel` recomputes with the real `configured` map, not a
// value present at mount. Without adopting that later update, the
// higgsfield default (issue #25) never applies even after the fetch lands.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoryboardMoodDraft } from '@open-design/contracts';
import type { MediaModel } from '../../src/media/models';
import { MoodLane, type MoodLaneProps } from '../../src/components/storyboard/MoodLane';

const CHEAP_MODEL: MediaModel = {
  id: 'bytedance/seedance-2-fast',
  label: 'seedance-2.0-fast (Kie)',
  hint: '',
  provider: 'kie',
  caps: ['t2v', 'i2v'],
};
const HIGGSFIELD_MODEL: MediaModel = {
  id: 'higgsfield/seedance_2_0_mini',
  label: 'Seedance 2.0 Mini (Higgsfield)',
  hint: '',
  provider: 'higgsfield',
  caps: ['t2v', 'i2v', 'kf'],
};

const MODELS: MediaModel[] = [CHEAP_MODEL, HIGGSFIELD_MODEL];
const DRAFTS: StoryboardMoodDraft[] = [];

function baseProps(overrides: Partial<MoodLaneProps> = {}): MoodLaneProps {
  return {
    drafts: DRAFTS,
    models: MODELS,
    configured: {},
    busy: false,
    frameUrl: (p: string) => `/frame/${p}`,
    onGenerate: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('MoodLane defaultModelId adoption (review finding #16)', () => {
  it('adopts a defaultModelId that arrives after mount (async config fetch landing late)', () => {
    // drafts is empty, so the lane starts open (see MoodLane's `open` initial
    // state) and the picker is present immediately — no toggle click needed.
    const { rerender } = render(<MoodLane {...baseProps({ defaultModelId: undefined })} />);
    const picker = () => screen.getByLabelText('Model') as HTMLSelectElement;
    expect(picker().value).toBe(CHEAP_MODEL.id);

    // StoryboardSection's config fetch resolves; StoryboardEditor recomputes
    // defaultMoodModel and MoodLane receives it as a prop update, not at
    // mount.
    rerender(<MoodLane {...baseProps({ defaultModelId: HIGGSFIELD_MODEL.id })} />);

    expect(picker().value).toBe(HIGGSFIELD_MODEL.id);
  });

  it('does NOT override a manual selection once the user has picked a model', () => {
    const { rerender } = render(<MoodLane {...baseProps({ defaultModelId: CHEAP_MODEL.id })} />);
    const picker = () => screen.getByLabelText('Model') as HTMLSelectElement;
    expect(picker().value).toBe(CHEAP_MODEL.id);

    fireEvent.change(picker(), { target: { value: HIGGSFIELD_MODEL.id } });
    expect(picker().value).toBe(HIGGSFIELD_MODEL.id);

    // A later defaultModelId prop change (e.g. config re-resolving) must not
    // silently clobber the user's own pick.
    rerender(<MoodLane {...baseProps({ defaultModelId: CHEAP_MODEL.id })} />);
    expect(picker().value).toBe(HIGGSFIELD_MODEL.id);
  });
});
