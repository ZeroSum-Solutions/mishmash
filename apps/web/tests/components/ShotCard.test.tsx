// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoryboardShot } from '@open-design/contracts';
import { ShotCard } from '../../src/components/storyboard/ShotCard';
import type { MediaModel } from '../../src/media/models';

const IMAGE_MODELS: MediaModel[] = [
  { id: 'gpt-image-2', label: 'gpt-image-2', hint: '', provider: 'openai', caps: ['t2i', 'i2i'], default: true },
];
const I2I_MODELS: MediaModel[] = [
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

function renderShotCard(shot: StoryboardShot, overrides: Partial<React.ComponentProps<typeof ShotCard>> = {}) {
  const handlers = {
    onGenerateStart: vi.fn(),
    onIterateStart: vi.fn(),
    onDeriveEnd: vi.fn(),
    onUsePreviousEndFrame: vi.fn(),
    onUploadFile: vi.fn(),
    onFieldChange: vi.fn(),
    onRender: vi.fn(),
  };
  render(
    <ShotCard
      shot={shot}
      previousShot={null}
      imageModels={IMAGE_MODELS}
      i2iImageModels={I2I_MODELS}
      videoModels={VIDEO_MODELS}
      configured={{
        openai: { apiKey: '', baseUrl: '', apiKeyConfigured: true },
        openrouter: { apiKey: '', baseUrl: '', apiKeyConfigured: true },
      }}
      frameUrl={(p) => `/frame/${p}`}
      busy={false}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

afterEach(() => {
  cleanup();
});

describe('ShotCard editor state machine', () => {
  it('with no start frame: Render is disabled and Derive-from-start is disabled', () => {
    renderShotCard(baseShot());
    expect(screen.getByTestId('render-shot-button')).toBeDisabled();
    expect(screen.getByText('Derive from start frame')).toBeDisabled();
    expect(screen.getByText('Generate')).toBeTruthy();
  });

  it('with a start frame but empty motion prompt: Render stays disabled (motion-prompt gating)', () => {
    renderShotCard(baseShot({ startFrame: { path: 'start.png', origin: 'generated' } }));
    expect(screen.getByTestId('render-shot-button')).toBeDisabled();
    // Iterate/Replace appear once a start frame exists.
    expect(screen.getByText('Iterate')).toBeTruthy();
    expect(screen.getByText('Replace')).toBeTruthy();
    // Derive-from-start becomes available once a start frame exists.
    expect(screen.getByText('Derive from start frame')).not.toBeDisabled();
  });

  it('with a start frame AND a motion prompt: Render becomes enabled', () => {
    renderShotCard(
      baseShot({
        startFrame: { path: 'start.png', origin: 'generated' },
        motionPrompt: 'the components separate smoothly and float apart',
      }),
    );
    expect(screen.getByTestId('render-shot-button')).not.toBeDisabled();
  });

  it('a whitespace-only motion prompt does not count as present (gating trims)', () => {
    renderShotCard(
      baseShot({
        startFrame: { path: 'start.png', origin: 'generated' },
        motionPrompt: '   ',
      }),
    );
    expect(screen.getByTestId('render-shot-button')).toBeDisabled();
  });

  it('a rendering shot disables Render even with a valid start frame + motion prompt', () => {
    renderShotCard(
      baseShot({
        startFrame: { path: 'start.png', origin: 'generated' },
        motionPrompt: 'motion',
        status: 'rendering',
      }),
    );
    expect(screen.getByTestId('render-shot-button')).toBeDisabled();
  });

  it('typing in the motion prompt calls onFieldChange with the new value', () => {
    const handlers = renderShotCard(baseShot({ startFrame: { path: 'start.png', origin: 'generated' } }));
    const textarea = screen.getByTestId('motion-prompt-input');
    fireEvent.change(textarea, { target: { value: 'camera pans slowly' } });
    expect(handlers.onFieldChange).toHaveBeenCalledWith({ motionPrompt: 'camera pans slowly' });
  });

  it('clicking Render calls onRender when enabled', () => {
    const handlers = renderShotCard(
      baseShot({ startFrame: { path: 'start.png', origin: 'generated' }, motionPrompt: 'motion' }),
    );
    fireEvent.click(screen.getByTestId('render-shot-button'));
    expect(handlers.onRender).toHaveBeenCalledTimes(1);
  });

  // React review R5: the Render/Retry label is shared with ShotRow.tsx via
  // computeRenderButtonMode — a failed shot that still has everything it
  // needs to re-render reads "Retry", not "Render".
  it('shows "Retry" (not "Render") on a failed shot that can still render', () => {
    renderShotCard(
      baseShot({
        startFrame: { path: 'start.png', origin: 'generated' },
        motionPrompt: 'motion',
        status: 'failed',
        error: 'daemon rejected the render',
      }),
    );
    const button = screen.getByTestId('render-shot-button');
    expect(button.textContent).toBe('Retry');
    expect(button).not.toBeDisabled();
  });

  it('shows "Render" (not a misleading "Retry") on a failed shot missing a prerequisite', () => {
    renderShotCard(baseShot({ status: 'failed', error: 'no start frame yet' }));
    const button = screen.getByTestId('render-shot-button');
    expect(button.textContent).toBe('Render');
    expect(button).toBeDisabled();
  });

  it("shows 'Use previous shot's end frame' only when there is no start frame and the previous shot has an end frame", () => {
    const previous = baseShot({ id: 'shot-0', endFrame: { path: 'prev-end.png', origin: 'derived' } });
    renderShotCard(baseShot(), { previousShot: previous });
    const button = screen.getByText("Use previous shot's end frame");
    expect(button).toBeTruthy();
    fireEvent.click(button);
  });

  it("hides 'Use previous shot's end frame' once this shot already has a start frame", () => {
    const previous = baseShot({ id: 'shot-0', endFrame: { path: 'prev-end.png', origin: 'derived' } });
    renderShotCard(baseShot({ startFrame: { path: 'start.png', origin: 'generated' } }), { previousShot: previous });
    expect(screen.queryByText("Use previous shot's end frame")).toBeNull();
  });

  it('start-frame Generate dialog submits with the typed prompt and selected model', () => {
    const handlers = renderShotCard(baseShot());
    fireEvent.click(screen.getByText('Generate'));
    const dialog = within(screen.getByTestId('start-frame-dialog'));
    fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'a warm product hero shot' } });
    fireEvent.click(dialog.getByText('Generate'));
    expect(handlers.onGenerateStart).toHaveBeenCalledWith('a warm product hero shot', 'gpt-image-2');
  });

  it('derive-end-frame dialog submits with the typed prompt and selected model', () => {
    const handlers = renderShotCard(baseShot({ startFrame: { path: 'start.png', origin: 'generated' } }));
    fireEvent.click(screen.getByText('Derive from start frame'));
    const dialog = within(screen.getByTestId('end-frame-dialog'));
    fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'the object rotates 90 degrees' } });
    fireEvent.click(dialog.getByText('Derive from start frame'));
    expect(handlers.onDeriveEnd).toHaveBeenCalledWith('the object rotates 90 degrees', 'gpt-image-2');
  });

  it('changing the video model recomputes resolution alongside the model id', () => {
    const models: MediaModel[] = [
      {
        id: 'openrouter/bytedance/seedance-2.0:1080p',
        label: 'seedance-2.0 1080p (OR)',
        hint: '',
        provider: 'openrouter',
        caps: ['t2v', 'i2v', 'kf'],
        default: true,
      },
      {
        id: 'openrouter/bytedance/seedance-2.0:480p',
        label: 'seedance-2.0 480p (OR)',
        hint: '',
        provider: 'openrouter',
        caps: ['t2v', 'i2v', 'kf'],
      },
    ];
    const handlers = renderShotCard(baseShot(), { videoModels: models });
    fireEvent.change(screen.getByLabelText('Model'), {
      target: { value: 'openrouter/bytedance/seedance-2.0:480p' },
    });
    expect(handlers.onFieldChange).toHaveBeenCalledWith({
      model: 'openrouter/bytedance/seedance-2.0:480p',
      resolution: '480p',
    });
  });

  // 'kf' (keyframe-pair) gating: findMediaModel() resolves shot.model against
  // the REAL catalog (apps/web/src/media/models.ts), not the test's local
  // `videoModels` fixture prop (which only feeds the <select> options) — so
  // 'grok-imagine-video' below is a real i2v-capable catalog id that does
  // NOT declare 'kf', and 'openrouter/bytedance/seedance-2.0:1080p' does.
  it('hides Derive-from-start-frame for a non-kf i2v model and shows a hint instead', () => {
    renderShotCard(
      baseShot({ model: 'grok-imagine-video', startFrame: { path: 'start.png', origin: 'generated' } }),
    );
    expect(screen.queryByText('Derive from start frame')).toBeNull();
    expect(screen.getByTestId('derive-end-frame-unsupported-hint')).toBeTruthy();
  });

  it('keeps Derive-from-start-frame enabled for a kf-capable model', () => {
    renderShotCard(
      baseShot({
        model: 'openrouter/bytedance/seedance-2.0:1080p',
        startFrame: { path: 'start.png', origin: 'generated' },
      }),
    );
    expect(screen.getByText('Derive from start frame')).not.toBeDisabled();
    expect(screen.queryByTestId('derive-end-frame-unsupported-hint')).toBeNull();
  });

  it('clears an existing end frame when switching to a non-kf video model, so it is never sent as endImage', () => {
    const models: MediaModel[] = [
      ...VIDEO_MODELS,
      { id: 'grok-imagine-video', label: 'grok-imagine-video', hint: '', provider: 'grok', caps: ['t2v', 'i2v', 'audio'] },
    ];
    const handlers = renderShotCard(
      baseShot({
        startFrame: { path: 'start.png', origin: 'generated' },
        endFrame: { path: 'end.png', origin: 'derived' },
      }),
      { videoModels: models },
    );
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'grok-imagine-video' } });
    expect(handlers.onFieldChange).toHaveBeenCalledWith({
      model: 'grok-imagine-video',
      resolution: '720p',
      endFrame: undefined,
    });
  });
});

describe('ShotCard upload — drag-and-drop and file-picker', () => {
  it('dropping an image file on the start-frame slot calls onUploadFile with the file', () => {
    const handlers = renderShotCard(baseShot());
    const dropzone = screen.getByTestId('start-frame-dropzone');
    const file = new File(['abc'], 'photo.png', { type: 'image/png' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
    expect(handlers.onUploadFile).toHaveBeenCalledWith('start', file);
  });

  it('ignores a start-frame drop that carries no image file', () => {
    const handlers = renderShotCard(baseShot());
    const dropzone = screen.getByTestId('start-frame-dropzone');
    const file = new File(['plain text'], 'notes.txt', { type: 'text/plain' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
    expect(handlers.onUploadFile).not.toHaveBeenCalled();
  });

  it('choosing a file via the start-frame Upload image input calls onUploadFile', () => {
    const handlers = renderShotCard(baseShot());
    const file = new File(['abc'], 'photo.png', { type: 'image/png' });
    const input = screen.getByTestId('start-frame-file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(handlers.onUploadFile).toHaveBeenCalledWith('start', file);
  });

  it('dropping an image file on the end-frame slot calls onUploadFile with the file', () => {
    const handlers = renderShotCard(baseShot({ startFrame: { path: 'start.png', origin: 'generated' } }));
    const dropzone = screen.getByTestId('end-frame-dropzone');
    const file = new File(['abc'], 'end.webp', { type: 'image/webp' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
    expect(handlers.onUploadFile).toHaveBeenCalledWith('end', file);
  });

  it('choosing a file via the end-frame Upload image input calls onUploadFile', () => {
    const handlers = renderShotCard(baseShot({ startFrame: { path: 'start.png', origin: 'generated' } }));
    const file = new File(['abc'], 'end.png', { type: 'image/png' });
    const input = screen.getByTestId('end-frame-file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(handlers.onUploadFile).toHaveBeenCalledWith('end', file);
  });

  it('disables the Upload image affordance on both slots while the shot is busy', () => {
    renderShotCard(
      baseShot({ startFrame: { path: 'start.png', origin: 'generated' }, endFrame: { path: 'end.png', origin: 'derived' } }),
      { busy: true },
    );
    expect(screen.getByTestId('start-frame-upload-button')).toBeDisabled();
    expect(screen.getByTestId('end-frame-upload-button')).toBeDisabled();
  });

  it('a drop on the start-frame slot while busy does not call onUploadFile', () => {
    const handlers = renderShotCard(baseShot(), { busy: true });
    const dropzone = screen.getByTestId('start-frame-dropzone');
    const file = new File(['abc'], 'photo.png', { type: 'image/png' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
    expect(handlers.onUploadFile).not.toHaveBeenCalled();
  });
});
