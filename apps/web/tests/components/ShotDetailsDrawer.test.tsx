// @vitest-environment jsdom
//
// React review R2 (minimal Tab focus trap) + R6 (focus moves to close on
// open, returns to whatever triggered it on close, Escape closes, body
// scroll-lock released) + R8/R9 (exit animation actually plays because the
// component stays mounted through it). ShotCard's own editor-state-machine
// behavior is covered by ShotCard.test.tsx — this file only covers what
// ShotDetailsDrawer itself owns.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoryboardShot } from '@open-design/contracts';
import { ShotDetailsDrawer } from '../../src/components/storyboard/ShotDetailsDrawer';
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

function renderDrawer(overrides: Partial<React.ComponentProps<typeof ShotDetailsDrawer>> = {}) {
  const onClose = vi.fn();
  const onExited = vi.fn();
  const utils = render(
    <ShotDetailsDrawer
      shot={baseShot()}
      index={0}
      open
      onClose={onClose}
      onExited={onExited}
      previousShot={null}
      imageModels={IMAGE_MODELS}
      i2iImageModels={IMAGE_MODELS}
      videoModels={VIDEO_MODELS}
      configured={{}}
      frameUrl={(p) => `/frame/${p}`}
      busy={false}
      onGenerateStart={vi.fn()}
      onIterateStart={vi.fn()}
      onDeriveEnd={vi.fn()}
      onUsePreviousEndFrame={vi.fn()}
      onUploadFile={vi.fn()}
      onFieldChange={vi.fn()}
      onRender={vi.fn()}
      {...overrides}
    />,
  );
  return { ...utils, onClose, onExited };
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('ShotDetailsDrawer focus management (react review R6)', () => {
  it('moves focus to the close button on open', () => {
    renderDrawer();
    expect(screen.getByTestId('shot-details-close')).toHaveFocus();
  });

  it('locks body scroll while open and releases it the moment closing is triggered', () => {
    const { rerender } = renderDrawer();
    expect(document.body.style.overflow).toBe('hidden');
    rerender(
      <ShotDetailsDrawer
        shot={baseShot()}
        index={0}
        open={false}
        onClose={vi.fn()}
        onExited={vi.fn()}
        previousShot={null}
        imageModels={IMAGE_MODELS}
        i2iImageModels={IMAGE_MODELS}
        videoModels={VIDEO_MODELS}
        configured={{}}
        frameUrl={(p) => `/frame/${p}`}
        busy={false}
        onGenerateStart={vi.fn()}
        onIterateStart={vi.fn()}
        onDeriveEnd={vi.fn()}
        onUsePreviousEndFrame={vi.fn()}
        onUploadFile={vi.fn()}
        onFieldChange={vi.fn()}
        onRender={vi.fn()}
      />,
    );
    // Released immediately — doesn't wait for the exit animation to finish.
    expect(document.body.style.overflow).toBe('');
  });

  it('returns focus to whatever had it before opening once closing is triggered', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'row trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    expect(trigger).toHaveFocus();

    const { rerender } = renderDrawer();
    expect(screen.getByTestId('shot-details-close')).toHaveFocus();

    rerender(
      <ShotDetailsDrawer
        shot={baseShot()}
        index={0}
        open={false}
        onClose={vi.fn()}
        onExited={vi.fn()}
        previousShot={null}
        imageModels={IMAGE_MODELS}
        i2iImageModels={IMAGE_MODELS}
        videoModels={VIDEO_MODELS}
        configured={{}}
        frameUrl={(p) => `/frame/${p}`}
        busy={false}
        onGenerateStart={vi.fn()}
        onIterateStart={vi.fn()}
        onDeriveEnd={vi.fn()}
        onUsePreviousEndFrame={vi.fn()}
        onUploadFile={vi.fn()}
        onFieldChange={vi.fn()}
        onRender={vi.fn()}
      />,
    );
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('calls onClose on Escape', () => {
    const { onClose } = renderDrawer();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking the close button', () => {
    const { onClose } = renderDrawer();
    fireEvent.click(screen.getByTestId('shot-details-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ShotDetailsDrawer exit animation (react review R8/R9)', () => {
  it('stays mounted through the exit animation after open flips false, then calls onExited', async () => {
    const { rerender, onExited } = renderDrawer();
    expect(screen.getByTestId('shot-card')).toBeTruthy();

    rerender(
      <ShotDetailsDrawer
        shot={baseShot()}
        index={0}
        open={false}
        onClose={vi.fn()}
        onExited={onExited}
        previousShot={null}
        imageModels={IMAGE_MODELS}
        i2iImageModels={IMAGE_MODELS}
        videoModels={VIDEO_MODELS}
        configured={{}}
        frameUrl={(p) => `/frame/${p}`}
        busy={false}
        onGenerateStart={vi.fn()}
        onIterateStart={vi.fn()}
        onDeriveEnd={vi.fn()}
        onUsePreviousEndFrame={vi.fn()}
        onUploadFile={vi.fn()}
        onFieldChange={vi.fn()}
        onRender={vi.fn()}
      />,
    );

    // Still in the DOM immediately after open flips false — this is what
    // lets the CSS exit transition actually play instead of the node
    // vanishing synchronously.
    expect(screen.getByTestId('shot-card')).toBeTruthy();
    expect(onExited).not.toHaveBeenCalled();

    await waitFor(() => expect(onExited).toHaveBeenCalledTimes(1));
  });
});

describe('ShotDetailsDrawer Tab focus trap (react review R2)', () => {
  function getFocusable() {
    const drawer = screen.getByTestId('shot-details-drawer');
    return Array.from(
      drawer.querySelectorAll<HTMLElement>('a[href], button, textarea, input, select, [tabindex]'),
    ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
  }

  it('wraps Tab from the last focusable element back to the first (the close button)', () => {
    renderDrawer();
    const closeButton = screen.getByTestId('shot-details-close');
    const last = getFocusable().at(-1)!;
    last.focus();
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(closeButton).toHaveFocus();
  });

  it('wraps Shift+Tab from the first focusable element (close button) to the last', () => {
    renderDrawer();
    const closeButton = screen.getByTestId('shot-details-close');
    closeButton.focus();
    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true });
    expect(closeButton).not.toHaveFocus();
  });

  it('never puts a hidden file input into the tab order', () => {
    renderDrawer();
    const drawer = screen.getByTestId('shot-details-drawer');
    const focusable = Array.from(
      drawer.querySelectorAll<HTMLElement>('a[href], button, textarea, input, select, [tabindex]'),
    ).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1);
    expect(focusable).not.toContain(screen.getByTestId('start-frame-file-input'));
    expect(focusable).not.toContain(screen.getByTestId('end-frame-file-input'));
  });
});
