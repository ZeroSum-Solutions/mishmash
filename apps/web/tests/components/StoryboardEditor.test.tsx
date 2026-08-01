// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Storyboard, StoryboardShot } from '@open-design/contracts';

const mockPatchStoryboard = vi.fn();
const mockUploadStoryboardFrame = vi.fn();
const mockReadFileAsDataUrl = vi.fn();
const mockGenerateStoryboardFrame = vi.fn();

vi.mock('../../src/providers/registry', () => ({
  assembleStoryboard: vi.fn(),
  exportStoryboardSlider: vi.fn(),
  generateStoryboardFrame: (...args: unknown[]) => mockGenerateStoryboardFrame(...args),
  openStoryboardFolder: vi.fn(),
  patchStoryboard: (...args: unknown[]) => mockPatchStoryboard(...args),
  readFileAsDataUrl: (...args: unknown[]) => mockReadFileAsDataUrl(...args),
  renderStoryboardShot: vi.fn(),
  storyboardFrameUrl: (p: string) => `/frame/${p}`,
  uploadStoryboardFrame: (...args: unknown[]) => mockUploadStoryboardFrame(...args),
  waitForMediaTask: vi.fn(),
}));

import { StoryboardEditor } from '../../src/components/storyboard/StoryboardEditor';

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

function baseDoc(overrides: Partial<Storyboard> = {}): Storyboard {
  return {
    id: 'sb-1',
    title: 'Test storyboard',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ratio: '16:9',
    moodDrafts: [],
    shots: [baseShot()],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('StoryboardEditor upload flows', () => {
  it('uploading a file into the start-frame slot PATCHes the shot with an origin: uploaded frame ref (no prompt/model fields)', async () => {
    mockReadFileAsDataUrl.mockResolvedValue('data:image/png;base64,AAAA');
    mockUploadStoryboardFrame.mockResolvedValue({ path: 'upload-abc.png' });
    mockPatchStoryboard.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
      ok: true,
      value: { ...baseDoc(), ...patch, updatedAt: '2026-01-01T00:01:00.000Z' },
    }));

    render(<StoryboardEditor storyboard={baseDoc()} configured={{}} onBack={() => {}} />);

    const file = new File(['abc'], 'photo.png', { type: 'image/png' });
    const input = screen.getByTestId('start-frame-file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(mockPatchStoryboard).toHaveBeenCalled());

    const [, patchArg] = mockPatchStoryboard.mock.calls.at(-1)!;
    const patchedShots = (patchArg as { shots: StoryboardShot[] }).shots;
    expect(patchedShots[0]!.startFrame).toEqual({ path: 'upload-abc.png', origin: 'uploaded' });
  });

  it('an oversize file surfaces a client-side error without calling uploadStoryboardFrame or readFileAsDataUrl', async () => {
    mockPatchStoryboard.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
      ok: true,
      value: { ...baseDoc(), ...patch, updatedAt: '2026-01-01T00:01:00.000Z' },
    }));
    render(<StoryboardEditor storyboard={baseDoc()} configured={{}} onBack={() => {}} />);

    const oversizeFile = new File(['x'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(oversizeFile, 'size', { value: 33 * 1024 * 1024 });
    const input = screen.getByTestId('start-frame-file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [oversizeFile] } });

    // No upload network call (nor the FileReader pass that would precede
    // it) should ever start for a file client validation already rejected —
    // the shot's error/status still persists through the normal PATCH
    // mutation pipeline (same as every other per-shot error in this editor),
    // so patchStoryboard IS expected to fire here.
    await waitFor(() => expect(screen.getByTestId('shot-card')).toHaveAttribute('data-shot-status', 'failed'));
    expect(mockReadFileAsDataUrl).not.toHaveBeenCalled();
    expect(mockUploadStoryboardFrame).not.toHaveBeenCalled();
  });

  it('dropping multiple images on the "Add shots from images" tile creates one shot per image', async () => {
    mockReadFileAsDataUrl.mockImplementation(async (file: File) => `data:image/png;base64,${file.name}`);
    mockUploadStoryboardFrame.mockImplementation(async (_id: string, dataUrl: string) => ({
      path: `upload-${dataUrl.split(',')[1]}`,
    }));
    mockPatchStoryboard.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
      ok: true,
      value: { ...baseDoc({ shots: [] }), ...patch, updatedAt: '2026-01-01T00:01:00.000Z' },
    }));

    render(<StoryboardEditor storyboard={baseDoc({ shots: [] })} configured={{}} onBack={() => {}} />);

    const fileA = new File(['a'], 'a.png', { type: 'image/png' });
    const fileB = new File(['b'], 'b.png', { type: 'image/png' });
    const input = screen.getByTestId('add-shots-from-images-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileA, fileB] } });

    await waitFor(() => {
      expect(screen.getAllByTestId('shot-card')).toHaveLength(2);
    });
    expect(mockUploadStoryboardFrame).toHaveBeenCalledTimes(2);
  });

  it('when file 2 of 3 fails mid-upload, shot 1 persists, file 3 is never attempted, and shotsUploadError renders (review finding #13)', async () => {
    mockReadFileAsDataUrl.mockImplementation(async (file: File) => `data:image/png;base64,${file.name}`);
    mockUploadStoryboardFrame
      .mockImplementationOnce(async (_id: string, dataUrl: string) => ({ path: `upload-${dataUrl.split(',')[1]}` }))
      .mockImplementationOnce(async () => {
        throw new Error('daemon rejected the second upload');
      });
    mockPatchStoryboard.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
      ok: true,
      value: { ...baseDoc({ shots: [] }), ...patch, updatedAt: '2026-01-01T00:01:00.000Z' },
    }));

    render(<StoryboardEditor storyboard={baseDoc({ shots: [] })} configured={{}} onBack={() => {}} />);

    const fileA = new File(['a'], 'a.png', { type: 'image/png' });
    const fileB = new File(['b'], 'b.png', { type: 'image/png' });
    const fileC = new File(['c'], 'c.png', { type: 'image/png' });
    const input = screen.getByTestId('add-shots-from-images-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [fileA, fileB, fileC] } });

    // Shot 1 (from file A, already committed before file B's rejection) is
    // the ONLY shot — the sequential for-loop in handleAddShotsFromImages
    // breaks on file B's throw, so file C's readFileAsDataUrl/upload never
    // fire at all.
    await waitFor(() => {
      expect(screen.getAllByTestId('shot-card')).toHaveLength(1);
    });
    expect(mockReadFileAsDataUrl).toHaveBeenCalledTimes(2);
    expect(mockUploadStoryboardFrame).toHaveBeenCalledTimes(2);
    expect(screen.getByText('daemon rejected the second upload')).toBeTruthy();
  });
});

describe('StoryboardEditor frame-generation failure (review finding #7)', () => {
  it('a failed start-frame generation (generateStoryboardFrame result.ok: false) sets status:failed so ShotCard actually renders the error', async () => {
    mockGenerateStoryboardFrame.mockResolvedValue({ ok: false, message: 'daemon rejected the prompt' });
    mockPatchStoryboard.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
      ok: true,
      value: { ...baseDoc(), ...patch, updatedAt: '2026-01-01T00:01:00.000Z' },
    }));

    render(<StoryboardEditor storyboard={baseDoc()} configured={{}} onBack={() => {}} />);

    fireEvent.click(screen.getByText('Generate'));
    const dialog = within(screen.getByTestId('start-frame-dialog'));
    fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'a warm product hero shot' } });
    fireEvent.click(dialog.getByText('Generate'));

    // Before the fix, this path set only `error` — status stayed 'draft'
    // and ShotCard's status==='failed' gate (see its `shot.status ===
    // 'failed'` render branch) never rendered the message at all.
    await waitFor(() => expect(screen.getByTestId('shot-card')).toHaveAttribute('data-shot-status', 'failed'));
    expect(screen.getByText('daemon rejected the prompt')).toBeTruthy();
  });

  it('a failed start-frame generation task (waitForMediaTask snap.status !== done) sets status:failed the same way', async () => {
    const registry = await import('../../src/providers/registry');
    mockGenerateStoryboardFrame.mockResolvedValue({ ok: true, value: { taskId: 'task-1', framePath: 'frame-1.png' } });
    vi.mocked(registry.waitForMediaTask).mockResolvedValue({
      status: 'failed',
      error: { message: 'provider timed out' },
    } as Awaited<ReturnType<typeof registry.waitForMediaTask>>);
    mockPatchStoryboard.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
      ok: true,
      value: { ...baseDoc(), ...patch, updatedAt: '2026-01-01T00:01:00.000Z' },
    }));

    render(<StoryboardEditor storyboard={baseDoc()} configured={{}} onBack={() => {}} />);

    fireEvent.click(screen.getByText('Generate'));
    const dialog = within(screen.getByTestId('start-frame-dialog'));
    fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'a warm product hero shot' } });
    fireEvent.click(dialog.getByText('Generate'));

    await waitFor(() => expect(screen.getByTestId('shot-card')).toHaveAttribute('data-shot-status', 'failed'));
    expect(screen.getByText('provider timed out')).toBeTruthy();
  });
});
