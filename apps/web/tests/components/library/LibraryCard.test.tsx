// @vitest-environment jsdom

// MM-020: the HTML/design-system thumbnail rendered `sandbox=""`, which
// blocks ALL scripts inside the iframe -- but agent-generated captures style
// themselves via CDN runtime JIT (cdn.tailwindcss.com), so nothing runs and
// the card shows raw, unstyled markup. It also pointed at `libraryAssetRawUrl`,
// which serves exactly the one registered file, so any relatively-referenced
// sibling (`href="assets/aura.css"`) 404s. This pins the fix: the iframe
// sandboxes with `allow-scripts` and points at the sibling-resolving
// `/file/<basename>` URL instead.

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryAsset } from '@open-design/contracts';

vi.mock('../../../src/providers/registry', () => ({
  libraryAssetRawUrl: (id: string) => `/api/library/assets/${id}/raw`,
  libraryAssetFileUrl: (asset: LibraryAsset) => {
    const basename = asset.relPath?.split('/').pop() || `${asset.contentHash}.html`;
    return `/api/library/assets/${asset.id}/file/${basename}`;
  },
}));

vi.mock('../../../src/router', () => ({
  navigate: vi.fn(),
}));

import { LibraryCard, type LibraryCardProps } from '../../../src/components/library/LibraryCard';

function makeAsset(over: Partial<LibraryAsset> = {}): LibraryAsset {
  const now = 1_700_000_000_000;
  return {
    id: 'asset-1',
    kind: 'html',
    storage: 'owned',
    capturedAt: now,
    archivedDate: '2024-01-01',
    contentHash: 'hash-asset-1',
    tags: [],
    sources: [],
    createdAt: now,
    updatedAt: now,
    mime: 'text/html',
    ...over,
  };
}

function renderCardContainer(asset: LibraryAsset) {
  const props: LibraryCardProps = {
    asset,
    index: 0,
    selected: false,
    selecting: false,
    editing: false,
    onToggle: vi.fn(),
    onRange: vi.fn(),
    onPreview: vi.fn(),
    onDelete: vi.fn(),
    onEditAsPage: vi.fn(),
    onOpenProject: vi.fn(),
  };
  return render(<LibraryCard {...props} />).container;
}

function renderCard(asset: LibraryAsset) {
  return renderCardContainer(asset).querySelector('iframe');
}

afterEach(() => {
  cleanup();
});

describe('LibraryCard HTML/design-system thumbnail', () => {
  it('sandboxes the iframe with allow-scripts, not the empty sandbox', () => {
    const frame = renderCard(makeAsset({ kind: 'html' }));
    expect(frame).toBeTruthy();
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('points an owned html capture at /file/<contentHash>.html, not /raw', () => {
    const frame = renderCard(makeAsset({ kind: 'html', storage: 'owned', contentHash: 'hash-asset-1' }));
    expect(frame?.getAttribute('src')).toBe('/api/library/assets/asset-1/file/hash-asset-1.html');
  });

  it('points a referenced design-system asset at /file/<relPath basename>', () => {
    const frame = renderCard(
      makeAsset({
        kind: 'design-system',
        storage: 'referenced',
        relPath: 'screens/scan-capture.html',
      }),
    );
    expect(frame?.getAttribute('src')).toBe('/api/library/assets/asset-1/file/scan-capture.html');
  });

  it('still lazy-loads the frame (unrelated to the sandbox/src fix)', () => {
    const frame = renderCard(makeAsset());
    expect(frame?.getAttribute('loading')).toBe('lazy');
    expect(frame?.getAttribute('scrolling')).toBe('no');
  });
});

// MM-021: a project delete materializes referenced Library rows it can, and
// marks the rest `broken` (gone origin project, or a copy that failed) —
// the reconcile sweep marks any other row whose bytes went missing the same
// way. Either way the row survives; only its rendering must change so the
// card doesn't point an <iframe>/<img> at bytes that will 404 forever.
describe('LibraryCard missing-source (broken) state', () => {
  it('renders a "Missing source" placeholder instead of the html iframe', () => {
    const container = renderCardContainer(makeAsset({ kind: 'html', broken: true }));
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.textContent).toContain('Missing source');
  });

  it('renders the placeholder instead of the raw <img> for a broken image asset', () => {
    const container = renderCardContainer(makeAsset({ kind: 'image', broken: true }));
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('Missing source');
  });

  it('renders the normal thumbnail (no placeholder) once an asset is not broken', () => {
    const frame = renderCard(makeAsset({ kind: 'html', broken: false }));
    expect(frame).toBeTruthy();
  });
});
