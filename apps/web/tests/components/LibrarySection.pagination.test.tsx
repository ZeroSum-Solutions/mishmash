// @vitest-environment jsdom

// Behavioral coverage for the Library grid's pagination (BUG-5) that the
// original fix shipped without: every earlier test hardcoded
// `truncated: false`, so nothing ever clicked "Load more" or asserted the
// second request's `offset`. This file anchors the actual load-more path,
// plus the three follow-up correctness fixes an adversarial review caught
// against real code:
//   - a stale loadMore() response (superseded by a filter-change load())
//     must not corrupt the grid/total/hasMore/cursor (generation guard),
//   - a live SSE ingest must bump the paging cursor + total so a later
//     loadMore() doesn't re-fetch and duplicate a row,
//   - a delete must shrink the paging cursor + total so a later loadMore()
//     doesn't skip a row that shifted into the just-vacated position.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryAsset, LibraryAssetListResponse } from '@open-design/contracts';

vi.mock('../../src/components/plugins-home/useInView', () => ({
  useInView: () => ({ ref: { current: null }, inView: false }),
}));

const fetchLibraryAssetsPage = vi.fn<(query?: unknown) => Promise<LibraryAssetListResponse>>();
const fetchLibraryAsset = vi.fn(async (): Promise<LibraryAsset | null> => null);
const deleteLibraryAsset = vi.fn(async (): Promise<boolean> => true);

vi.mock('../../src/providers/registry', () => ({
  fetchLibraryAssetsPage: (...args: unknown[]) => fetchLibraryAssetsPage(...(args as [])),
  fetchLibraryAsset: (...args: unknown[]) => fetchLibraryAsset(...(args as [])),
  libraryAssetRawUrl: (id: string) => `/raw/${id}`,
  applyLibraryAsset: vi.fn(),
  deleteLibraryAsset: (...args: unknown[]) => deleteLibraryAsset(...(args as [])),
  editLibraryAssetAsPage: vi.fn(),
  fetchDesignSystem: vi.fn(),
  fetchDesignSystems: vi.fn(async () => []),
  fetchLibraryAssetAsFile: vi.fn(),
}));

import { LibrarySection } from '../../src/components/LibrarySection';

/** Minimal controllable `EventSource` stub: captures listeners per instance
 * so a test can synthesize a live `ingest`/`delete` SSE event on demand. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners: Record<string, Array<(ev: MessageEvent) => void>> = {};
  constructor() {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (ev: MessageEvent) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  close() {}
  emit(type: string, data: unknown) {
    const ev = { data: JSON.stringify(data) } as MessageEvent;
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }
}

let now = 1_700_000_000_000;
function makeAsset(over: Partial<LibraryAsset> = {}): LibraryAsset {
  now += 1000;
  return {
    id: over.id ?? `asset-${now}`,
    kind: 'image',
    storage: 'owned',
    capturedAt: now,
    archivedDate: '2024-01-01',
    contentHash: `hash-${over.id ?? now}`,
    tags: [],
    sources: [],
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function page(assets: LibraryAsset[], total: number, truncated: boolean): LibraryAssetListResponse {
  return { assets, total, truncated };
}

describe('LibrarySection pagination', () => {
  beforeEach(() => {
    fetchLibraryAssetsPage.mockReset();
    fetchLibraryAsset.mockReset().mockResolvedValue(null);
    deleteLibraryAsset.mockReset().mockResolvedValue(true);
    FakeEventSource.instances = [];
    (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the count + Load more only when truncated, and fetches the next page at the correct offset', async () => {
    const firstPage = [makeAsset({ id: 'a1', sourceTitle: 'One' }), makeAsset({ id: 'a2', sourceTitle: 'Two' })];
    const secondPage = [makeAsset({ id: 'a3', sourceTitle: 'Three' })];
    fetchLibraryAssetsPage
      .mockResolvedValueOnce(page(firstPage, 3, true))
      .mockResolvedValueOnce(page(secondPage, 3, false));

    render(<LibrarySection active onOpenProject={() => {}} />);
    await screen.findByText('Load more');
    expect(screen.getByText('Showing 2 of 3 assets')).toBeTruthy();

    fireEvent.click(screen.getByText('Load more'));

    await waitFor(() => expect(fetchLibraryAssetsPage).toHaveBeenCalledTimes(2));
    // The second call's offset must equal how many rows the first page
    // actually returned -- BUG-5's whole point (page past the cap without
    // gaps or duplicates).
    expect(fetchLibraryAssetsPage.mock.calls[1]?.[0]).toMatchObject({ offset: 2 });

    await screen.findByText('Three');
    // The button disappears once truncated flips false on the last page.
    await waitFor(() => expect(screen.queryByText('Load more')).toBeNull());
  });

  it('discards a stale loadMore response when a filter change supersedes it mid-flight', async () => {
    const initialPage = [makeAsset({ id: 'old-1', sourceTitle: 'Old One' })];
    let resolveLoadMore: ((v: LibraryAssetListResponse) => void) | null = null;
    const pendingLoadMore = new Promise<LibraryAssetListResponse>((resolve) => {
      resolveLoadMore = resolve;
    });
    const newFilterPage = [makeAsset({ id: 'new-1', sourceTitle: 'New One', kind: 'html' })];

    fetchLibraryAssetsPage
      .mockResolvedValueOnce(page(initialPage, 5, true)) // initial load()
      .mockImplementationOnce(() => pendingLoadMore) // loadMore() -- stays pending
      .mockResolvedValueOnce(page(newFilterPage, 1, false)); // the superseding load()

    render(<LibrarySection active onOpenProject={() => {}} />);
    await screen.findByText('Old One');
    await screen.findByText('Load more');

    fireEvent.click(screen.getByText('Load more'));
    await waitFor(() => expect(fetchLibraryAssetsPage).toHaveBeenCalledTimes(2));

    // A filter change WHILE loadMore is still in flight fires a fresh
    // load() that must become the new source of truth.
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by kind' }), {
      target: { value: 'html' },
    });
    await waitFor(() => expect(fetchLibraryAssetsPage).toHaveBeenCalledTimes(3));
    await screen.findByText('New One');

    // Now let the stale loadMore response land -- without the generation
    // guard this would append 'Old Two' onto the fresh grid and flip
    // truncated back to true.
    await act(async () => {
      resolveLoadMore?.(page([makeAsset({ id: 'old-2', sourceTitle: 'Old Two' })], 5, true));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText('Old One')).toBeNull();
    expect(screen.queryByText('Old Two')).toBeNull();
    expect(screen.getByText('New One')).toBeTruthy();
    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('bumps the paging cursor and total on a live SSE ingest so a later loadMore does not duplicate rows', async () => {
    const initialPage = [makeAsset({ id: 'a1', sourceTitle: 'One' }), makeAsset({ id: 'a2', sourceTitle: 'Two' })];
    const nextPage = [makeAsset({ id: 'a3', sourceTitle: 'Three' })];
    fetchLibraryAssetsPage
      .mockResolvedValueOnce(page(initialPage, 3, true))
      .mockResolvedValueOnce(page(nextPage, 3, false));

    render(<LibrarySection active onOpenProject={() => {}} />);
    await screen.findByText('One');
    await screen.findByText('Load more');

    // A live clipper capture streams in -- a genuinely new row, not yet part
    // of any fetched page.
    const liveAsset = makeAsset({ id: 'live-1', sourceTitle: 'Live One' });
    fetchLibraryAsset.mockResolvedValueOnce(liveAsset);
    FakeEventSource.instances[0]?.emit('ingest', { assetId: 'live-1' });

    await screen.findByText('Live One');
    await screen.findByText('Showing 3 of 4 assets');

    fireEvent.click(screen.getByText('Load more'));
    await waitFor(() => expect(fetchLibraryAssetsPage).toHaveBeenCalledTimes(2));
    // Without the fix the cursor would still read 2 (the initial page's
    // length, ignoring the live-inserted row) and re-request offset 2,
    // re-fetching a row already visible in the grid.
    expect(fetchLibraryAssetsPage.mock.calls[1]?.[0]).toMatchObject({ offset: 3 });
  });

  it('reconciles the paging cursor and total after a delete so a later loadMore does not skip a row', async () => {
    const initialPage = [makeAsset({ id: 'a1', sourceTitle: 'One' }), makeAsset({ id: 'a2', sourceTitle: 'Two' })];
    const nextPage = [makeAsset({ id: 'a3', sourceTitle: 'Three' })];
    fetchLibraryAssetsPage
      .mockResolvedValueOnce(page(initialPage, 3, true))
      .mockResolvedValueOnce(page(nextPage, 2, false));

    render(<LibrarySection active onOpenProject={() => {}} />);
    await screen.findByText('One');
    await screen.findByText('Two');

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]!);
    await waitFor(() => expect(screen.queryByText('One')).toBeNull());
    await screen.findByText('Showing 1 of 2 assets');

    fireEvent.click(screen.getByText('Load more'));
    await waitFor(() => expect(fetchLibraryAssetsPage).toHaveBeenCalledTimes(2));
    // Without the fix the cursor would still read 2 (unaware the delete
    // removed one of the two already-fetched rows), skipping the row that
    // shifted into the vacated position.
    expect(fetchLibraryAssetsPage.mock.calls[1]?.[0]).toMatchObject({ offset: 1 });
    await screen.findByText('Three');
  });

  it('suppresses the Load more affordance for the element kind filter even when the server reports truncated', async () => {
    const initialPage = [makeAsset({ id: 'a1', sourceTitle: 'One', kind: 'image' })];
    fetchLibraryAssetsPage
      .mockResolvedValueOnce(page(initialPage, 5, true))
      // `kind=element` queries the server as `kind:'image'`; it can still
      // report truncated:true (more images exist) even though 0 of them are
      // elements client-side. The affordance must stay hidden regardless.
      .mockResolvedValueOnce(page([], 5, true));

    render(<LibrarySection active onOpenProject={() => {}} />);
    await screen.findByText('One');

    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by kind' }), {
      target: { value: 'element' },
    });
    await waitFor(() => expect(fetchLibraryAssetsPage).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Load more')).toBeNull();
  });
});
