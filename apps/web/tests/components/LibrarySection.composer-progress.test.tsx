// @vitest-environment jsdom

// W8B work item 5: LibraryComposer has shipped `taskSnapshot` / `onCancelTask`
// since wave 7 (LibraryComposer.tsx:29-41, 79-98 — a progress line, a
// percentage, and a Cancel button), and its own unit test
// (tests/components/library/LibraryComposer.test.tsx) proves the child works
// in isolation. The PARENT never passes either prop: LibrarySection.tsx:1202
// renders `<LibraryComposer onGenerate={generateFromComposer} />` and
// `generateFromComposer` (:707-736) awaits `waitForMediaTask` without ever
// reading a snapshot back out of it.
//
// This drives the OUTERMOST caller — the whole LibrarySection tree, not the
// composer alone — because that is the only place the gap lives.
//
// RED on base: with the mocked `waitForMediaTask` invoking its `onSnapshot`
// callback with a running snapshot, none of the composer's progress queries
// find anything and there is no Cancel button to click. A missing element,
// not an import error: LibrarySection and LibraryComposer both exist and
// render fine on base (the "Generate" button below is found either way).

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryAsset, LibraryAssetListResponse, MediaTaskSnapshot } from '@open-design/contracts';

vi.mock('../../src/components/plugins-home/useInView', () => ({
  useInView: () => ({ ref: { current: null }, inView: false }),
}));

const fetchLibraryAssetsPage = vi.fn(
  async (): Promise<LibraryAssetListResponse> => ({ assets: [], total: 0, truncated: false }),
);
const fetchLibraryAsset = vi.fn(async (): Promise<LibraryAsset | null> => null);
const generateProjectMedia = vi.fn();
const waitForMediaTask = vi.fn();
/** `providers/registry`'s `cancelMediaTask` collapses the daemon's response to
 *  `{ ok }`, but the refusal fixture below carries the 409 body's `error` too
 *  (D-18: no invented wire), so the mock's type has to admit it. */
const cancelMediaTask = vi.fn(
  async (): Promise<{ ok: boolean; error?: { code: string; message: string } }> => ({ ok: true }),
);
const syncLibrary = vi.fn(async () => null);
const readFileAsDataUrl = vi.fn(async () => 'data:image/png;base64,AAAA');

vi.mock('../../src/providers/registry', () => ({
  fetchLibraryAssetsPage: (...args: unknown[]) => fetchLibraryAssetsPage(...(args as [])),
  fetchLibraryAsset: (...args: unknown[]) => fetchLibraryAsset(...(args as [])),
  libraryAssetRawUrl: (id: string) => `/raw/${id}`,
  applyLibraryAsset: vi.fn(),
  deleteLibraryAsset: vi.fn(),
  editLibraryAssetAsPage: vi.fn(),
  fetchDesignSystem: vi.fn(),
  fetchDesignSystems: vi.fn(async () => []),
  fetchLibraryAssetAsFile: vi.fn(),
  generateProjectMedia: (...args: unknown[]) => generateProjectMedia(...(args as [])),
  waitForMediaTask: (...args: unknown[]) => waitForMediaTask(...(args as [])),
  cancelMediaTask: (...args: unknown[]) => cancelMediaTask(...(args as [])),
  syncLibrary: (...args: unknown[]) => syncLibrary(...(args as [])),
  readFileAsDataUrl: (...args: unknown[]) => readFileAsDataUrl(...(args as [])),
}));

const createProject = vi.fn();
vi.mock('../../src/state/projects', () => ({
  createProject: (...args: unknown[]) => createProject(...(args as [])),
}));

import { LibrarySection } from '../../src/components/LibrarySection';

function makeAsset(): LibraryAsset {
  const now = 1_700_000_000_000;
  return {
    id: 'asset-1',
    kind: 'image',
    storage: 'owned',
    capturedAt: now,
    archivedDate: '2024-01-01',
    contentHash: 'hash-asset-1',
    tags: [],
    sources: [],
    createdAt: now,
    updatedAt: now,
    sourceTitle: 'A photo',
  };
}

/**
 * The daemon's real in-flight wire shape for a media task, built from the
 * contracts-owned {@link MediaTaskSnapshot} type rather than a hand-written
 * literal (D-18: no invented wire). `nextSince` mirrors what
 * `mediaTaskSnapshot()` returns for a two-line progress list.
 */
const RUNNING_SNAPSHOT: MediaTaskSnapshot = {
  taskId: 'task-1',
  status: 'running',
  startedAt: 1_700_000_000_000,
  endedAt: null,
  progress: ['queued image generation', 'rendering: 40%'],
  nextSince: 2,
  file: null,
  fraction: 0.4,
};

type WaitOptions = { totalBudgetMs?: number; onSnapshot?: (snapshot: MediaTaskSnapshot) => void };

describe('LibrarySection — composer progress and cancel (W8B work item 5)', () => {
  beforeEach(() => {
    fetchLibraryAssetsPage.mockReset().mockResolvedValue({ assets: [makeAsset()], total: 1, truncated: false });
    fetchLibraryAsset.mockReset().mockResolvedValue(null);
    generateProjectMedia.mockReset();
    waitForMediaTask.mockReset();
    cancelMediaTask.mockReset().mockResolvedValue({ ok: true });
    syncLibrary.mockReset().mockResolvedValue(null);
    readFileAsDataUrl.mockReset().mockResolvedValue('data:image/png;base64,AAAA');
    createProject.mockReset();
    (globalThis as { EventSource?: unknown }).EventSource = class {
      addEventListener() {}
      close() {}
    };
  });

  afterEach(() => {
    cleanup();
  });

  /** Starts a generation whose media task never terminates, so the composer
   *  stays in its in-flight state for the assertions. */
  async function startStalledGeneration(): Promise<void> {
    createProject.mockResolvedValue({ project: { id: 'proj-1' }, conversationId: 'conv-1' });
    generateProjectMedia.mockResolvedValue({ taskId: 'task-1' });
    waitForMediaTask.mockImplementation(async (_taskId: string, options: WaitOptions = {}) => {
      options.onSnapshot?.(RUNNING_SNAPSHOT);
      return new Promise<MediaTaskSnapshot>(() => {});
    });

    render(<LibrarySection active onOpenProject={() => {}} />);
    await screen.findByText('A photo');

    fireEvent.change(screen.getByPlaceholderText('Describe any visual idea…'), {
      target: { value: 'a cozy reading nook' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('renders the live progress line and fraction the daemon reports', async () => {
    await startStalledGeneration();

    await waitFor(() => expect(waitForMediaTask).toHaveBeenCalledTimes(1));
    const [, options] = waitForMediaTask.mock.calls[0] as [string, WaitOptions];
    expect(typeof options.onSnapshot, 'LibrarySection must subscribe to per-tick snapshots').toBe('function');

    // queryAllByText: the progress line and its wrapper both carry the text,
    // so an exact-one query would throw on the ambiguity instead of asserting.
    expect(
      screen.queryAllByText(/rendering: 40%/i).length,
      'RED on base: the composer gets no taskSnapshot, so the progress line never renders',
    ).toBeGreaterThan(0);
    expect(screen.queryAllByText(/\(40%\)/).length, 'the fraction must render as a percentage').toBeGreaterThan(0);
  });

  it('cancels the in-flight task from the composer Cancel button', async () => {
    await startStalledGeneration();

    const cancelButton = screen.queryByRole('button', { name: 'Cancel' });
    expect(cancelButton, 'RED on base: no Cancel button exists in the composer').not.toBeNull();

    await act(async () => {
      fireEvent.click(cancelButton as HTMLElement);
    });
    expect(cancelMediaTask).toHaveBeenCalledWith('task-1');
  });

  it('tells the user when the daemon refuses to cancel the task', async () => {
    // The real refusal: `POST /api/media/tasks/:id/cancel` answers 409 with
    // `MediaTaskCancelRefusedResponse` for a generate task, because
    // `cancelLiveMediaTask` only admits encode/download jobs and video
    // imports. That is the ONLY task this composer creates, so the Cancel
    // button's honest outcome today is a refusal — and a refusal the UI
    // swallows is a button that does nothing.
    cancelMediaTask.mockResolvedValue({
      ok: false,
      error: {
        code: 'NOT_CANCELABLE',
        message:
          'task task-1 is not a background encode/download job tracked by this route (kind: generate, surface: image); it cannot be canceled here',
      },
    });
    await startStalledGeneration();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await Promise.resolve();
      await Promise.resolve();
    });

    // RED on base: `cancelComposerTask` is `void cancelMediaTask(id)`, so the
    // refusal never reaches the screen and the task keeps running silently.
    await waitFor(() =>
      expect(
        screen.queryAllByText(/could not cancel that generation/i).length,
        'a refused cancel must be surfaced, the way VideoImportPanel surfaces videoImport.cancelError',
      ).toBeGreaterThan(0),
    );
  });
});
