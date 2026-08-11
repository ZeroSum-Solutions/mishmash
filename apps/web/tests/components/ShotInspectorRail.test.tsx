// @vitest-environment jsdom
//
// ShotInspectorRail.tsx (MM-017) — the persistent right-docked panel that
// replaced the modal ShotDetailsDrawer. Unlike the drawer it replaced, it is
// normal document flow (no backdrop/fixed positioning/focus trap — see the
// module doc comment), always mounted once the storyboard has shots, and
// shows an idle state instead of unmounting when nothing is selected. Its
// own shot-editing behavior (frame slots, dialogs, model/duration, render
// gating) is covered by ShotCard.test.tsx — this file only covers what the
// rail itself owns: the idle state and the header's summary + prev/next
// "Change" navigation + close.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoryboardShot } from '@open-design/contracts';
import { ShotInspectorRail } from '../../src/components/storyboard/ShotInspectorRail';
import type { MediaModel } from '../../src/media/models';

const IMAGE_MODELS: MediaModel[] = [
  { id: 'gpt-image-2', label: 'gpt-image-2', hint: '', provider: 'openai', caps: ['t2i', 'i2i'], default: true },
];
const VIDEO_MODELS: MediaModel[] = [
  {
    id: 'openrouter/bytedance/seedance-2.0:1080p',
    label: 'seedance-2.0 1080p (OR)',
    hint: '',
    provider: 'openrouter',
    caps: ['t2v', 'i2v', 'kf'],
    default: true,
  },
];

function baseShot(overrides: Partial<StoryboardShot> = {}): StoryboardShot {
  return {
    id: 'shot-1',
    order: 0,
    motionPrompt: '',
    model: 'openrouter/bytedance/seedance-2.0:1080p',
    resolution: '1080p',
    durationSec: 5,
    status: 'draft',
    ...overrides,
  };
}

function renderRail(overrides: Partial<React.ComponentProps<typeof ShotInspectorRail>> = {}) {
  const handlers = {
    onGenerateStart: vi.fn(),
    onIterateStart: vi.fn(),
    onDeriveEnd: vi.fn(),
    onUsePreviousEndFrame: vi.fn(),
    onUploadFile: vi.fn(),
    onFieldChange: vi.fn(),
    onRender: vi.fn(),
    onSelectPrevious: vi.fn(),
    onSelectNext: vi.fn(),
    onClose: vi.fn(),
  };
  render(
    <ShotInspectorRail
      shot={baseShot()}
      index={0}
      previousShot={null}
      imageModels={IMAGE_MODELS}
      i2iImageModels={IMAGE_MODELS}
      videoModels={VIDEO_MODELS}
      configured={{}}
      frameUrl={(p) => `/frame/${p}`}
      busy={false}
      canSelectPrevious={false}
      canSelectNext={false}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

afterEach(() => {
  cleanup();
});

describe('ShotInspectorRail idle state', () => {
  it('renders a hint and no ShotCard when nothing is selected', () => {
    renderRail({ shot: null });
    expect(screen.getByText('Select a shot to see its details here.')).toBeTruthy();
    expect(screen.queryByTestId('shot-card')).toBeNull();
  });

  it('still renders the rail container (docked, not unmounted) while idle', () => {
    renderRail({ shot: null });
    expect(screen.getByTestId('shot-details-drawer')).toBeTruthy();
  });
});

describe('ShotInspectorRail selected-shot summary (Higgsfield rail-content pattern: art + title + description)', () => {
  it('shows a placeholder description when the shot has no motion prompt yet', () => {
    renderRail();
    expect(screen.getByTestId('shot-inspector-summary-prompt').textContent).toBe('No motion prompt yet');
  });

  it('shows the motion prompt as the one-line description once set', () => {
    renderRail({ shot: baseShot({ motionPrompt: 'camera pans left' }) });
    expect(screen.getByTestId('shot-inspector-summary-prompt').textContent).toBe('camera pans left');
  });

  it('shows the shot title with its 1-based position', () => {
    renderRail({ index: 2 });
    expect(screen.getByText('Shot 3')).toBeTruthy();
  });

  it('renders the ShotCard editor body for the selected shot', () => {
    renderRail();
    expect(screen.getByTestId('shot-card')).toBeTruthy();
  });
});

describe('ShotInspectorRail prev/next "Change" navigation', () => {
  it('disables previous at the start of the list', () => {
    renderRail({ canSelectPrevious: false });
    expect(screen.getByTestId('shot-inspector-prev')).toBeDisabled();
  });

  it('calls onSelectPrevious when enabled', () => {
    const handlers = renderRail({ canSelectPrevious: true });
    fireEvent.click(screen.getByTestId('shot-inspector-prev'));
    expect(handlers.onSelectPrevious).toHaveBeenCalledTimes(1);
  });

  it('disables next at the end of the list', () => {
    renderRail({ canSelectNext: false });
    expect(screen.getByTestId('shot-inspector-next')).toBeDisabled();
  });

  it('calls onSelectNext when enabled', () => {
    const handlers = renderRail({ canSelectNext: true });
    fireEvent.click(screen.getByTestId('shot-inspector-next'));
    expect(handlers.onSelectNext).toHaveBeenCalledTimes(1);
  });
});

describe('ShotInspectorRail close', () => {
  it('calls onClose when the close button is clicked', () => {
    const handlers = renderRail();
    fireEvent.click(screen.getByTestId('shot-details-close'));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });
});
