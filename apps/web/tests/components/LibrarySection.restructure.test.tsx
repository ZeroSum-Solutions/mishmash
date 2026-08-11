// @vitest-environment jsdom

// MM-016 restructure coverage that sits above the pure-logic tests in
// tests/components/library/: the grid size slider's rendered state, and the
// composer's end-to-end wiring through the EXISTING media-generate route
// (createProject -> generateProjectMedia -> waitForMediaTask -> syncLibrary
// -> reload), all via mocked transports.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryAsset, LibraryAssetListResponse } from '@open-design/contracts';

vi.mock('../../src/components/plugins-home/useInView', () => ({
  useInView: () => ({ ref: { current: null }, inView: false }),
}));

const fetchLibraryAssetsPage = vi.fn(
  async (): Promise<LibraryAssetListResponse> => ({ assets: [], total: 0, truncated: false }),
);
const fetchLibraryAsset = vi.fn(async (): Promise<LibraryAsset | null> => null);
const generateProjectMedia = vi.fn();
const waitForMediaTask = vi.fn();
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
  syncLibrary: (...args: unknown[]) => syncLibrary(...(args as [])),
  readFileAsDataUrl: (...args: unknown[]) => readFileAsDataUrl(...(args as [])),
}));

const createProject = vi.fn();
vi.mock('../../src/state/projects', () => ({
  createProject: (...args: unknown[]) => createProject(...(args as [])),
}));

import { LibrarySection } from '../../src/components/LibrarySection';

function makeAsset(over: Partial<LibraryAsset> = {}): LibraryAsset {
  const now = 1_700_000_000_000;
  return {
    id: over.id ?? 'asset-1',
    kind: 'image',
    storage: 'owned',
    capturedAt: now,
    archivedDate: '2024-01-01',
    contentHash: `hash-${over.id ?? 'asset-1'}`,
    tags: [],
    sources: [],
    createdAt: now,
    updatedAt: now,
    sourceTitle: 'A photo',
    ...over,
  };
}

describe('LibrarySection restructure', () => {
  beforeEach(() => {
    fetchLibraryAssetsPage
      .mockReset()
      .mockResolvedValue({ assets: [makeAsset()], total: 1, truncated: false });
    fetchLibraryAsset.mockReset().mockResolvedValue(null);
    generateProjectMedia.mockReset();
    waitForMediaTask.mockReset();
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

  describe('grid size slider', () => {
    it('defaults to the middle step and widens the grid item min-width when dragged up', async () => {
      render(<LibrarySection active onOpenProject={() => {}} />);
      await screen.findByText('A photo');

      const slider = screen.getByRole('slider', { name: 'Grid item size' }) as HTMLInputElement;
      expect(slider.value).toBe('2'); // default step, 180px

      fireEvent.change(slider, { target: { value: '4' } });
      expect(slider.value).toBe('4');

      const gridWrap = document.querySelector('[style*="--library-card-min"]') as HTMLElement | null;
      expect(gridWrap?.style.getPropertyValue('--library-card-min')).toBe('280px');
    });
  });

  describe('composer', () => {
    it('is disabled with an empty prompt and enables once text is typed', async () => {
      render(<LibrarySection active onOpenProject={() => {}} />);
      await screen.findByText('A photo');

      const generateBtn = screen.getByRole('button', { name: 'Generate' }) as HTMLButtonElement;
      expect(generateBtn.disabled).toBe(true);

      fireEvent.change(screen.getByPlaceholderText('Describe any visual idea…'), {
        target: { value: 'a cozy reading nook' },
      });
      expect(generateBtn.disabled).toBe(false);
    });

    it('drives generation through createProject -> generateProjectMedia -> waitForMediaTask -> syncLibrary -> reload', async () => {
      createProject.mockResolvedValue({ project: { id: 'proj-1' }, conversationId: 'conv-1' });
      generateProjectMedia.mockResolvedValue({ taskId: 'task-1' });
      waitForMediaTask.mockResolvedValue({ status: 'done' });

      render(<LibrarySection active onOpenProject={() => {}} />);
      await screen.findByText('A photo');
      await waitFor(() => expect(fetchLibraryAssetsPage).toHaveBeenCalledTimes(1));

      fireEvent.change(screen.getByPlaceholderText('Describe any visual idea…'), {
        target: { value: 'a cozy reading nook' },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
        // Flush the generate → wait → sync → reload promise chain.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(createProject).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'a cozy reading nook', skillId: null, designSystemId: null }),
      );
      expect(generateProjectMedia).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({ surface: 'image', prompt: 'a cozy reading nook' }),
      );
      expect(waitForMediaTask).toHaveBeenCalledWith('task-1', expect.any(Object));
      await waitFor(() => expect(syncLibrary).toHaveBeenCalledTimes(1));
      // A successful generation clears the prompt back to empty.
      await waitFor(() =>
        expect((screen.getByPlaceholderText('Describe any visual idea…') as HTMLInputElement).value).toBe(''),
      );
    });

    it('surfaces a failed generation as an inline error and keeps the prompt for retry', async () => {
      createProject.mockResolvedValue({ project: { id: 'proj-1' }, conversationId: 'conv-1' });
      generateProjectMedia.mockResolvedValue({ taskId: 'task-1' });
      waitForMediaTask.mockResolvedValue({ status: 'failed', error: { message: 'provider timed out' } });

      render(<LibrarySection active onOpenProject={() => {}} />);
      await screen.findByText('A photo');

      fireEvent.change(screen.getByPlaceholderText('Describe any visual idea…'), {
        target: { value: 'a neon skyline' },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      await screen.findByText('provider timed out');
      expect((screen.getByPlaceholderText('Describe any visual idea…') as HTMLInputElement).value).toBe(
        'a neon skyline',
      );
    });
  });
});
