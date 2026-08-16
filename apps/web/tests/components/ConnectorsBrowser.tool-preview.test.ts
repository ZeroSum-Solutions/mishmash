// Covers `connector-tool-preview` (canvas-feature-inventory.json). The
// existing ConnectorsBrowser.test.tsx exercises the *first* page fetch (the
// drawer's initial hydrateTools call and the "Load more tools" button's
// presence) but never actually clicks "Load more" — so the append/dedup
// merge that a second page produces, and the "no more pages" completion
// signal, have no test anywhere. Those are pure functions; test them
// directly rather than driving a full drawer render + pagination click.

import { describe, expect, it } from 'vitest';
import type { ConnectorDetail, ConnectorToolDetail } from '@open-design/contracts';
import {
  getConnectorDisplayToolCount,
  hasLoadedAllAdvertisedConnectorTools,
  mergeConnectorActionResult,
  mergeConnectorToolPreview,
} from '../../src/components/ConnectorsBrowser';

function tool(name: string): ConnectorToolDetail {
  return {
    name,
    title: name.replace(/_/g, ' '),
    safety: { sideEffect: 'read', approval: 'auto', reason: 'Reads data.' },
    refreshEligible: true,
  };
}

function connector(overrides: Partial<ConnectorDetail> = {}): ConnectorDetail {
  return {
    id: 'notion',
    name: 'Notion',
    provider: 'Composio',
    category: 'Productivity',
    status: 'connected',
    tools: [],
    ...overrides,
  };
}

describe('hasLoadedAllAdvertisedConnectorTools', () => {
  it('is not done while the server still advertises a next-page cursor', () => {
    const c = connector({
      toolCount: 2,
      tools: [tool('a'), tool('b')],
      toolsNextCursor: 'page-2',
    });
    expect(hasLoadedAllAdvertisedConnectorTools(c)).toBe(false);
  });

  it('is done once the loaded count reaches the advertised total and no cursor remains', () => {
    const c = connector({ toolCount: 2, tools: [tool('a'), tool('b')] });
    expect(hasLoadedAllAdvertisedConnectorTools(c)).toBe(true);
  });

  it('falls back to "any tools loaded" when the provider never advertised a total', () => {
    expect(hasLoadedAllAdvertisedConnectorTools(connector({ tools: [] }))).toBe(false);
    expect(hasLoadedAllAdvertisedConnectorTools(connector({ tools: [tool('a')] }))).toBe(true);
  });
});

describe('getConnectorDisplayToolCount', () => {
  it('prefers the advertised toolCount over the loaded tools length', () => {
    expect(getConnectorDisplayToolCount(connector({ toolCount: 50, tools: [tool('a')] }))).toBe(50);
  });

  it('falls back to the loaded tools length when toolCount is unknown', () => {
    expect(getConnectorDisplayToolCount(connector({ tools: [tool('a'), tool('b')] }))).toBe(2);
  });
});

describe('mergeConnectorToolPreview (pagination append)', () => {
  it('appends a second page onto the first without duplicating overlapping tools', () => {
    // Composio provider data: a "Load more" page can legitimately re-list a
    // tool the first page already returned (cursor semantics aren't a hard
    // exclusive boundary) — the merge must not double it in the drawer list.
    const current = connector({
      toolCount: 3,
      tools: [tool('search_pages'), tool('create_page')],
      toolsNextCursor: 'page-2',
      toolsHasMore: true,
    });
    const nextPage = connector({
      toolCount: 3,
      tools: [tool('create_page'), tool('update_page')],
      toolsHasMore: false,
    });

    const merged = mergeConnectorToolPreview(current, nextPage, true);

    expect(merged.tools.map((t) => t.name)).toEqual(['search_pages', 'create_page', 'update_page']);
  });

  it('drops the next-page cursor once the final page reports no cursor of its own', () => {
    const current = connector({ tools: [tool('a')], toolsNextCursor: 'page-2', toolsHasMore: true });
    const finalPage = connector({ tools: [tool('b')], toolsHasMore: false });

    const merged = mergeConnectorToolPreview(current, finalPage, true);

    expect('toolsNextCursor' in merged).toBe(false);
    expect(merged.toolsHasMore).toBe(false);
    expect(hasLoadedAllAdvertisedConnectorTools(merged)).toBe(true);
  });

  it('defaults toolsHasMore to false whenever the next page response omits it, even if the previous page had more', () => {
    // A malformed/incomplete API response must never let a stale "there's
    // more" flag persist just because the field was left out this time.
    const current = connector({ tools: [tool('a')], toolsHasMore: true });
    const ambiguousPage = connector({ tools: [tool('b')] });

    const merged = mergeConnectorToolPreview(current, ambiguousPage, true);

    expect(merged.toolsHasMore).toBe(false);
  });

  it('keeps a carried-forward cursor when the next page explicitly repeats it', () => {
    const current = connector({ tools: [tool('a')], toolsNextCursor: 'page-2' });
    const stillPaging = connector({ tools: [tool('b')], toolsNextCursor: 'page-3' });

    const merged = mergeConnectorToolPreview(current, stillPaging, true);

    expect(merged.toolsNextCursor).toBe('page-3');
  });

  it('replaces the tool list outright (no append) for a fresh, non-paginated fetch', () => {
    const current = connector({ tools: [tool('stale_a'), tool('stale_b')] });
    const fresh = connector({ tools: [tool('search_pages')] });

    const merged = mergeConnectorToolPreview(current, fresh, false);

    expect(merged.tools.map((t) => t.name)).toEqual(['search_pages']);
  });

  it('falls back to the current toolCount and featuredToolNames when the next page omits them', () => {
    const current = connector({
      toolCount: 48,
      featuredToolNames: ['search_pages'],
      tools: [tool('search_pages')],
    });
    const nextPage = connector({ tools: [tool('create_page')] });

    const merged = mergeConnectorToolPreview(current, nextPage, true);

    expect(merged.toolCount).toBe(48);
    expect(merged.featuredToolNames).toEqual(['search_pages']);
  });

  it('prefers the next page toolCount and featuredToolNames over the current when both define them and they differ', () => {
    // The fallback-when-omitted case above never proves *priority* direction,
    // because it never gives `next` a defined, differing value to win with —
    // `next.toolCount ?? current.toolCount` and
    // `current.toolCount ?? next.toolCount` both pass it. Pin the direction
    // explicitly: a later page correcting the server's advertised total (or
    // recomputing which tools are "featured") must win over the stale value
    // the first page cached.
    const current = connector({
      toolCount: 48,
      featuredToolNames: ['search_pages'],
      tools: [tool('search_pages')],
    });
    const nextPage = connector({
      toolCount: 52,
      featuredToolNames: ['create_page'],
      tools: [tool('create_page')],
    });

    const merged = mergeConnectorToolPreview(current, nextPage, true);

    expect(merged.toolCount).toBe(52);
    expect(merged.featuredToolNames).toEqual(['create_page']);
  });
});

describe('mergeConnectorActionResult', () => {
  it('keeps the cached tool list when an action response carries no tools of its own', () => {
    const current = connector({ tools: [tool('search_pages'), tool('create_page')] });
    const actionResult = connector({ tools: [] });

    const merged = mergeConnectorActionResult(current, actionResult);

    expect(merged.tools.map((t) => t.name)).toEqual(['search_pages', 'create_page']);
  });

  it('replaces the tool list when the action response carries its own tools', () => {
    const current = connector({ tools: [tool('search_pages')] });
    const actionResult = connector({ tools: [tool('refreshed_tool')] });

    const merged = mergeConnectorActionResult(current, actionResult);

    expect(merged.tools.map((t) => t.name)).toEqual(['refreshed_tool']);
  });
});
