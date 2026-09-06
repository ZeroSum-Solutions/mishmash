// @vitest-environment jsdom
//
// Red spec for the Library half of the per-tab stream budget (INV-3.2 / D-21
// option C). The Library grid's live channel is one of the six HTTP/1.1
// connections a browser allows per origin, and before the budget existed the
// grid held it for as long as the Library page stayed open — including while
// the whole tab sat in the background doing nothing with it.
//
// Two things have to hold together. The tab must not hold the connection while
// it is hidden, and the grid must not go stale because of that: captures and
// deletions the daemon emitted while the tab held no connection are not
// replayed, so a tab coming back has to re-read the grid once.

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryAsset, LibraryAssetListResponse } from '@open-design/contracts';

vi.mock('../../src/components/plugins-home/useInView', () => ({
  useInView: () => ({ ref: { current: null }, inView: false }),
}));

const fetchLibraryAssetsPage = vi.fn(
  async (): Promise<LibraryAssetListResponse> => ({ assets: [], total: 0, truncated: false }),
);
const fetchLibraryAsset = vi.fn(async (): Promise<LibraryAsset | null> => null);
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
}));

import { LibrarySection } from '../../src/components/LibrarySection';

const LIBRARY_EVENTS_URL = '/api/library/events';

class FakeEventSource {
  url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    openedStreams.push(this);
  }

  addEventListener(): void { /* the budget, not the payload, is under test */ }
  removeEventListener(): void { /* no-op */ }
  close(): void { this.closed = true; }
}

let openedStreams: FakeEventSource[] = [];
let visibility: DocumentVisibilityState = 'visible';

function liveLibraryStreams(): FakeEventSource[] {
  return openedStreams.filter((s) => s.url === LIBRARY_EVENTS_URL && !s.closed);
}

function setVisibility(next: DocumentVisibilityState): void {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

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

beforeEach(() => {
  openedStreams = [];
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => visibility === 'hidden',
  });
  fetchLibraryAssetsPage
    .mockReset()
    .mockResolvedValue({ assets: [makeAsset()], total: 1, truncated: false });
  fetchLibraryAsset.mockReset().mockResolvedValue(null);
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('per-tab library stream budget', () => {
  it('releases the library-events connection while the document is hidden', async () => {
    render(<LibrarySection active onOpenProject={() => {}} />);

    await waitFor(() => expect(liveLibraryStreams()).toHaveLength(1));

    setVisibility('hidden');
    await waitFor(() => expect(liveLibraryStreams()).toHaveLength(0));

    setVisibility('visible');
    await waitFor(() => expect(liveLibraryStreams()).toHaveLength(1));
  });

  it('re-reads the grid once when the tab comes back from hidden', async () => {
    render(<LibrarySection active onOpenProject={() => {}} />);

    await waitFor(() => expect(liveLibraryStreams()).toHaveLength(1));
    await waitFor(() => expect(fetchLibraryAssetsPage.mock.calls.length).toBeGreaterThan(0));
    const readsBeforeHiding = fetchLibraryAssetsPage.mock.calls.length;

    setVisibility('hidden');
    await waitFor(() => expect(liveLibraryStreams()).toHaveLength(0));
    setVisibility('visible');

    // Events the daemon emitted while the tab held no connection are gone, so
    // the grid the user comes back to has to be re-read rather than trusted.
    await waitFor(() =>
      expect(fetchLibraryAssetsPage.mock.calls.length).toBeGreaterThan(readsBeforeHiding));
  });
});
