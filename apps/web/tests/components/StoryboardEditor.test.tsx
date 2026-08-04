// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Storyboard, StoryboardShot } from '@open-design/contracts';

const mockPatchStoryboard = vi.fn();
const mockUploadStoryboardFrame = vi.fn();
const mockReadFileAsDataUrl = vi.fn();
const mockGenerateStoryboardFrame = vi.fn();
const mockDraftStoryboardShots = vi.fn();

vi.mock('../../src/providers/registry', () => ({
  assembleStoryboard: vi.fn(),
  clearStoryboardStyleReference: vi.fn(),
  setStoryboardStyleReference: vi.fn(),
  draftStoryboardShots: (...args: unknown[]) => mockDraftStoryboardShots(...args),
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

/**
 * Shot editing (frame slots, dialogs, motion prompt) now lives in
 * ShotDetailsDrawer, opened per shot from ShotRow's "Details" toggle (PRD C4
 * outcome 1) — tests that used to find those elements inline on the page
 * must open the drawer first. `nth` selects which shot's row to open when a
 * test has more than one.
 */
function openShotDetails(nth = 0) {
  fireEvent.click(screen.getAllByTestId('shot-details-toggle')[nth]!);
}

describe('StoryboardEditor upload flows', () => {
  it('uploading a file into the start-frame slot PATCHes the shot with an origin: uploaded frame ref (no prompt/model fields)', async () => {
    mockReadFileAsDataUrl.mockResolvedValue('data:image/png;base64,AAAA');
    mockUploadStoryboardFrame.mockResolvedValue({ path: 'upload-abc.png' });
    mockPatchStoryboard.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
      ok: true,
      value: { ...baseDoc(), ...patch, updatedAt: '2026-01-01T00:01:00.000Z' },
    }));

    render(<StoryboardEditor storyboard={baseDoc()} configured={{}} onBack={() => {}} />);
    openShotDetails();

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
    openShotDetails();

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

    // One compact row per shot (ShotCard/the drawer only mounts for
    // whichever single shot has its details open, if any — see
    // ShotRow.tsx/ShotDetailsDrawer.tsx).
    await waitFor(() => {
      expect(screen.getAllByTestId('shot-row')).toHaveLength(2);
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
      expect(screen.getAllByTestId('shot-row')).toHaveLength(1);
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
    openShotDetails();

    fireEvent.click(screen.getByText('Generate'));
    const dialog = within(screen.getByTestId('start-frame-dialog'));
    fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'a warm product hero shot' } });
    fireEvent.click(dialog.getByText('Generate'));

    // Before the fix, this path set only `error` — status stayed 'draft'
    // and ShotCard's status==='failed' gate (see its `shot.status ===
    // 'failed'` render branch) never rendered the message at all. The row's
    // own status badge (ShotRow.tsx, PRD C4 outcome 3) shows the same error
    // text too, so scope the lookup to ShotCard's drawer content specifically.
    await waitFor(() => expect(screen.getByTestId('shot-card')).toHaveAttribute('data-shot-status', 'failed'));
    expect(within(screen.getByTestId('shot-card')).getByText('daemon rejected the prompt')).toBeTruthy();
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
    openShotDetails();

    fireEvent.click(screen.getByText('Generate'));
    const dialog = within(screen.getByTestId('start-frame-dialog'));
    fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'a warm product hero shot' } });
    fireEvent.click(dialog.getByText('Generate'));

    await waitFor(() => expect(screen.getByTestId('shot-card')).toHaveAttribute('data-shot-status', 'failed'));
    expect(within(screen.getByTestId('shot-card')).getByText('provider timed out')).toBeTruthy();
  });
});

describe('StoryboardEditor shot details drawer (PRD C4 outcome 1)', () => {
  it('opens ShotCard inside the drawer on Details, and closes it on the close button', async () => {
    render(<StoryboardEditor storyboard={baseDoc()} configured={{}} onBack={() => {}} />);
    expect(screen.queryByTestId('shot-card')).toBeNull();

    openShotDetails();
    expect(screen.getByTestId('shot-details-drawer')).toBeTruthy();
    expect(screen.getByTestId('shot-card')).toBeTruthy();
    expect(screen.getByTestId('shot-details-toggle')).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByTestId('shot-details-close'));
    // aria-expanded flips immediately (openShotId clears synchronously);
    // the drawer itself stays mounted a little longer to play its exit
    // animation (react review R8/R9) before it actually unmounts.
    expect(screen.getByTestId('shot-details-toggle')).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => expect(screen.queryByTestId('shot-card')).toBeNull());
  });

  // React review R7: deleting the shot whose drawer is open must not leave
  // openShotId pointing at a shot that no longer exists.
  it('self-heals and closes the drawer if its shot is deleted while open', async () => {
    render(<StoryboardEditor storyboard={baseDoc()} configured={{}} onBack={() => {}} />);
    openShotDetails();
    expect(screen.getByTestId('shot-card')).toBeTruthy();

    fireEvent.click(screen.getByTestId('row-actions-trigger'));
    fireEvent.click(within(screen.getByTestId('row-actions-menu')).getByText('Delete shot'));

    await waitFor(() => expect(screen.queryByTestId('shot-card')).toBeNull());
    expect(screen.queryAllByTestId('shot-row')).toHaveLength(0);
  });
});

describe('StoryboardEditor page heading (react review R10)', () => {
  it('exposes an h1-equivalent heading with the storyboard title; Shots stays an h2', () => {
    render(<StoryboardEditor storyboard={baseDoc({ title: 'My Launch Video' })} configured={{}} onBack={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: 'My Launch Video' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Shots' })).toBeTruthy();
  });
});

describe('StoryboardEditor aria-controls wiring (react review R12)', () => {
  it('points the "More ways to start" toggle at the actual starters panel', () => {
    render(<StoryboardEditor storyboard={baseDoc()} configured={{}} onBack={() => {}} />);
    const toggle = screen.getByTestId('toggle-start-options');
    const targetId = toggle.getAttribute('aria-controls');
    expect(targetId).toBeTruthy();
    expect(document.getElementById(targetId!)).toBeTruthy();
  });
});

describe('StoryboardEditor footer Assemble weight (grok design critique e6)', () => {
  it('stays secondary (subtle) until at least one shot has rendered successfully', () => {
    render(<StoryboardEditor storyboard={baseDoc()} configured={{}} onBack={() => {}} />);
    const assembleButton = screen.getByText('Assemble video').closest('button')!;
    expect(assembleButton).toHaveClass('subtle');
    expect(assembleButton).not.toHaveClass('primary');
    expect(assembleButton).toBeDisabled();
  });

  it('promotes to primary once a shot has a done render with output', () => {
    render(
      <StoryboardEditor
        storyboard={baseDoc({ shots: [baseShot({ status: 'done', output: 'out.mp4' })] })}
        configured={{}}
        onBack={() => {}}
      />,
    );
    const assembleButton = screen.getByText('Assemble video').closest('button')!;
    expect(assembleButton).toHaveClass('primary');
    expect(assembleButton).not.toBeDisabled();
  });
});

describe('StoryboardEditor shots empty state (PRD C4 outcome 2)', () => {
  it('creates a shot pre-filled with a template motion prompt from the empty state', () => {
    mockPatchStoryboard.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
      ok: true,
      value: { ...baseDoc({ shots: [] }), ...patch, updatedAt: '2026-01-01T00:01:00.000Z' },
    }));

    render(<StoryboardEditor storyboard={baseDoc({ shots: [] })} configured={{}} onBack={() => {}} />);
    expect(screen.queryAllByTestId('shot-row')).toHaveLength(0);

    fireEvent.click(screen.getByTestId('shot-template-pan-left'));

    const rows = screen.getAllByTestId('shot-row');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText(/pans left/)).toBeTruthy();
  });

  it('creates a shot pre-filled with the typed brief from the empty state', () => {
    mockPatchStoryboard.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
      ok: true,
      value: { ...baseDoc({ shots: [] }), ...patch, updatedAt: '2026-01-01T00:01:00.000Z' },
    }));

    render(<StoryboardEditor storyboard={baseDoc({ shots: [] })} configured={{}} onBack={() => {}} />);

    fireEvent.change(screen.getByTestId('shot-brief-input'), { target: { value: 'a slow push-in on the product' } });
    fireEvent.click(screen.getByTestId('shot-brief-submit'));

    const rows = screen.getAllByTestId('shot-row');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText('a slow push-in on the product')).toBeTruthy();
  });

  it('collapses the template/brief starters behind a toggle once a shot already exists', () => {
    render(<StoryboardEditor storyboard={baseDoc()} configured={{}} onBack={() => {}} />);
    const toggle = screen.getByTestId('toggle-start-options');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Still mounted (keep-mounted + class toggle), just collapsed.
    expect(screen.getByTestId('shot-template-pan-left')).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('StoryboardEditor draft-the-whole-storyboard-from-a-brief', () => {
  it('calls draftStoryboardShots with the brief, shot count, and expectedUpdatedAt, and applies the returned storyboard', async () => {
    const draftedDoc = baseDoc({
      shots: [baseShot(), baseShot({ id: 'shot-2', order: 1, motionPrompt: 'a slow pan across the skyline' })],
      updatedAt: '2026-01-01T00:05:00.000Z',
    });
    mockDraftStoryboardShots.mockResolvedValue({ ok: true, value: { storyboard: draftedDoc, drafted: 1 } });

    render(<StoryboardEditor storyboard={baseDoc({ shots: [] })} configured={{}} onBack={() => {}} />);

    fireEvent.change(screen.getByTestId('shot-brief-input'), { target: { value: 'a 2-shot city teaser' } });
    fireEvent.click(screen.getByTestId('shot-draft-submit'));

    await waitFor(() => expect(mockDraftStoryboardShots).toHaveBeenCalledTimes(1));
    expect(mockDraftStoryboardShots).toHaveBeenCalledWith('sb-1', {
      brief: 'a 2-shot city teaser',
      shotCount: 4,
      expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('shot-row')).toHaveLength(2);
    });
  });

  it('surfaces the daemon error message as-is when draftStoryboardShots fails (e.g. NO_TEXT_PROVIDER)', async () => {
    mockDraftStoryboardShots.mockResolvedValue({
      ok: false,
      message: 'Add a text-capable provider under Settings to draft a storyboard.',
    });

    render(<StoryboardEditor storyboard={baseDoc({ shots: [] })} configured={{}} onBack={() => {}} />);

    fireEvent.change(screen.getByTestId('shot-brief-input'), { target: { value: 'a 2-shot city teaser' } });
    fireEvent.click(screen.getByTestId('shot-draft-submit'));

    await waitFor(() =>
      expect(screen.getByText('Add a text-capable provider under Settings to draft a storyboard.')).toBeTruthy(),
    );
    expect(screen.queryAllByTestId('shot-row')).toHaveLength(0);
  });

  // FIX 3 (MEDIUM): result.value.drafted (how many shots the daemon
  // actually appended) was ignored entirely — a user asking for 6 shots who
  // got 2 back had no way to know without counting rows by hand.
  it('surfaces a partial-fulfillment message when drafted is fewer than the requested shot count (FIX 3)', async () => {
    const draftedDoc = baseDoc({
      shots: [baseShot()],
      updatedAt: '2026-01-01T00:05:00.000Z',
    });
    mockDraftStoryboardShots.mockResolvedValue({ ok: true, value: { storyboard: draftedDoc, drafted: 1 } });

    render(<StoryboardEditor storyboard={baseDoc({ shots: [] })} configured={{}} onBack={() => {}} />);

    fireEvent.change(screen.getByTestId('shot-brief-input'), { target: { value: 'a 4-shot product launch teaser' } });
    fireEvent.click(screen.getByTestId('shot-draft-submit'));

    await waitFor(() => expect(mockDraftStoryboardShots).toHaveBeenCalledTimes(1));
    // Requested the default shot count (4, per the earlier test in this
    // file) but the daemon only drafted 1.
    await waitFor(() => {
      const notice = screen.getByTestId('shot-draft-notice');
      expect(notice.textContent).toBe('Drafted 1 of 4 shots. Try a more detailed brief to fill in the rest.');
      // The draft SUCCEEDED — a shortfall is informational, so it is
      // announced politely as a status and must not render through the
      // error surface in danger styling.
      expect(notice.getAttribute('role')).toBe('status');
      expect(screen.queryByTestId('shot-draft-error')).toBeNull();
    });
  });

  it('does not surface a partial-fulfillment message when drafted meets the requested shot count', async () => {
    const draftedDoc = baseDoc({
      shots: [baseShot(), baseShot({ id: 'shot-2', order: 1 }), baseShot({ id: 'shot-3', order: 2 }), baseShot({ id: 'shot-4', order: 3 })],
      updatedAt: '2026-01-01T00:05:00.000Z',
    });
    mockDraftStoryboardShots.mockResolvedValue({ ok: true, value: { storyboard: draftedDoc, drafted: 4 } });

    render(<StoryboardEditor storyboard={baseDoc({ shots: [] })} configured={{}} onBack={() => {}} />);

    fireEvent.change(screen.getByTestId('shot-brief-input'), { target: { value: 'a 4-shot product launch teaser' } });
    fireEvent.click(screen.getByTestId('shot-draft-submit'));

    await waitFor(() => {
      expect(screen.getAllByTestId('shot-row')).toHaveLength(4);
    });
    expect(screen.queryByText(/Drafted \d+ of \d+ shots/)).toBeNull();
  });

  it('on a 409 conflict, resyncs local state to the server-supplied storyboard and surfaces the conflict message', async () => {
    const serverDoc = baseDoc({
      shots: [baseShot({ id: 'shot-server', motionPrompt: 'someone else already added this' })],
      updatedAt: '2026-01-01T00:02:00.000Z',
    });
    mockDraftStoryboardShots.mockResolvedValue({
      ok: false,
      status: 409,
      message: 'storyboard changed',
      conflict: serverDoc,
    });

    render(<StoryboardEditor storyboard={baseDoc({ shots: [] })} configured={{}} onBack={() => {}} />);

    fireEvent.change(screen.getByTestId('shot-brief-input'), { target: { value: 'a 2-shot city teaser' } });
    fireEvent.click(screen.getByTestId('shot-draft-submit'));

    await waitFor(() => expect(screen.getByText('storyboard changed')).toBeTruthy());
    await waitFor(() => {
      expect(screen.getAllByTestId('shot-row')).toHaveLength(1);
    });
    expect(screen.getByText('someone else already added this')).toBeTruthy();
  });
});
