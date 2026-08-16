// Focused coverage for the MM-016 Assets restructure's new pure logic:
// date-bucketing for the grouped grid, the per-day group-select toggle, and
// the rail's type/source count tally. Extracted out of LibrarySection.tsx
// into apps/web/src/components/library/library-utils.ts.

import { describe, expect, it } from 'vitest';
import type { LibraryAsset } from '@open-design/contracts';
import {
  cardIdsInBand,
  computeRailCounts,
  dayHeading,
  groupByDay,
  mergeIngestedAssets,
  parseEventAssetId,
  toggleGroupInSelection,
  ymdLocal,
  type CardRect,
} from '../../../src/components/library/library-utils';

let seq = 0;
function makeAsset(over: Partial<LibraryAsset> = {}): LibraryAsset {
  seq += 1;
  const now = 1_700_000_000_000 + seq * 1000;
  return {
    id: over.id ?? `asset-${seq}`,
    kind: 'image',
    storage: 'owned',
    capturedAt: now,
    archivedDate: '2024-01-01',
    contentHash: `hash-${over.id ?? seq}`,
    tags: [],
    sources: [],
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe('groupByDay', () => {
  it('buckets assets by archivedDate, newest day first, keeping flat index', () => {
    const a1 = makeAsset({ id: 'a1', archivedDate: '2026-08-08' });
    const a2 = makeAsset({ id: 'a2', archivedDate: '2026-08-09' });
    const a3 = makeAsset({ id: 'a3', archivedDate: '2026-08-08' });
    const groups = groupByDay([a1, a2, a3]);

    expect(groups.map((g) => g.key)).toEqual(['2026-08-09', '2026-08-08']);
    expect(groups[0]?.items).toEqual([{ asset: a2, index: 1 }]);
    expect(groups[1]?.items).toEqual([
      { asset: a1, index: 0 },
      { asset: a3, index: 2 },
    ]);
  });

  it('falls back to a local YYYY-MM-DD of capturedAt when archivedDate is missing', () => {
    const capturedAt = new Date(2026, 6, 4, 10, 30).getTime(); // 2026-07-04
    const a1 = makeAsset({ id: 'a1', archivedDate: '', capturedAt });
    const groups = groupByDay([a1]);
    expect(groups[0]?.key).toBe(ymdLocal(new Date(capturedAt)));
  });
});

describe('dayHeading', () => {
  it('reads Today / Yesterday for the current and prior local day', () => {
    const today = ymdLocal(new Date());
    const yesterday = ymdLocal(new Date(Date.now() - 86_400_000));
    expect(dayHeading(today)).toBe('Today');
    expect(dayHeading(yesterday)).toBe('Yesterday');
  });

  it('formats any other day as a localized date', () => {
    expect(dayHeading('2026-08-04')).toBe(
      new Date(2026, 7, 4).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    );
  });

  it('falls back to the raw key for an unparsable bucket', () => {
    expect(dayHeading('not-a-date')).toBe('not-a-date');
  });
});

describe('toggleGroupInSelection', () => {
  it('selects every id in the group when none are selected', () => {
    const next = toggleGroupInSelection(new Set(), ['a', 'b', 'c']);
    expect([...next].sort()).toEqual(['a', 'b', 'c']);
  });

  it('selects every id in the group when only some are selected (adds the rest)', () => {
    const next = toggleGroupInSelection(new Set(['a']), ['a', 'b', 'c']);
    expect([...next].sort()).toEqual(['a', 'b', 'c']);
  });

  it('deselects the whole group once every id in it is already selected', () => {
    const next = toggleGroupInSelection(new Set(['a', 'b', 'c', 'z']), ['a', 'b', 'c']);
    expect([...next].sort()).toEqual(['z']);
  });

  it('leaves selection outside the group untouched', () => {
    const next = toggleGroupInSelection(new Set(['z']), ['a', 'b']);
    expect([...next].sort()).toEqual(['a', 'b', 'z']);
  });

  it('is a no-op for an empty group', () => {
    const selected = new Set(['a']);
    expect(toggleGroupInSelection(selected, [])).toBe(selected);
  });
});

describe('computeRailCounts', () => {
  it('tallies assets by badge kind, not raw storage kind', () => {
    const image = makeAsset({ id: 'img', kind: 'image' });
    const video = makeAsset({ id: 'vid', kind: 'video' });
    // An element-pick clip is stored as `html` + a `metadata.element` marker
    // and must read as the `element` badge kind, not `html`.
    const element = makeAsset({ id: 'el', kind: 'html', metadata: { element: { tag: 'div' } } });
    const html = makeAsset({ id: 'page', kind: 'html' });

    const counts = computeRailCounts([image, video, element, html]);
    expect(counts.total).toBe(4);
    expect(counts.byKind.image).toBe(1);
    expect(counts.byKind.video).toBe(1);
    expect(counts.byKind.element).toBe(1);
    expect(counts.byKind.html).toBe(1);
  });

  it('separately tallies assets whose primary source is "generated"', () => {
    const generated = makeAsset({
      id: 'gen',
      kind: 'image',
      sources: [{ id: 's1', assetId: 'gen', sourceKind: 'generated', createdAt: Date.now() }],
    });
    const uploaded = makeAsset({
      id: 'up',
      kind: 'image',
      sources: [{ id: 's2', assetId: 'up', sourceKind: 'manual-upload', createdAt: Date.now() }],
    });

    const counts = computeRailCounts([generated, uploaded]);
    expect(counts.generated).toBe(1);
    expect(counts.byKind.image).toBe(2);
  });
});

describe('parseEventAssetId', () => {
  it('reads assetId out of a well-formed SSE payload', () => {
    expect(parseEventAssetId('{"assetId":"asset-42"}')).toBe('asset-42');
  });

  it('rejects a non-string payload without throwing', () => {
    expect(parseEventAssetId(42)).toBeNull();
    expect(parseEventAssetId(null)).toBeNull();
    expect(parseEventAssetId(undefined)).toBeNull();
    expect(parseEventAssetId({ assetId: 'asset-42' })).toBeNull();
  });

  it('rejects malformed JSON instead of throwing', () => {
    expect(parseEventAssetId('{not json')).toBeNull();
  });

  it('rejects a payload whose assetId is not a string', () => {
    expect(parseEventAssetId('{"assetId":42}')).toBeNull();
    expect(parseEventAssetId('{"assetId":null}')).toBeNull();
    expect(parseEventAssetId('{}')).toBeNull();
  });

  it('rejects valid JSON that is not an object (e.g. a bare array or number)', () => {
    expect(parseEventAssetId('[1,2,3]')).toBeNull();
    expect(parseEventAssetId('42')).toBeNull();
  });
});

describe('mergeIngestedAssets', () => {
  it('returns the previous list unchanged (same reference) when nothing new arrived', () => {
    const prev = [makeAsset({ id: 'a1' })];
    expect(mergeIngestedAssets(prev, [])).toBe(prev);
  });

  it('prepends genuinely new assets ahead of the existing list, reversing fetch order', () => {
    const existing = makeAsset({ id: 'existing' });
    const newOlder = makeAsset({ id: 'new-older' });
    const newNewer = makeAsset({ id: 'new-newer' });
    // mergeIngestedAssets reverses the incoming `fetched` batch before
    // prepending it, so callers must hand it new rows oldest-first for the
    // merged list to come out newest-first (matching created_at DESC).
    const merged = mergeIngestedAssets([existing], [newOlder, newNewer]);
    expect(merged.map((a) => a.id)).toEqual(['new-newer', 'new-older', 'existing']);
  });

  it('refreshes an already-present asset in place without reordering the list', () => {
    const a1 = makeAsset({ id: 'a1' });
    const a2 = makeAsset({ id: 'a2' });
    const refreshedA1 = { ...a1, tags: ['updated'] };
    const merged = mergeIngestedAssets([a1, a2], [refreshedA1]);
    expect(merged.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(merged[0]).toEqual(refreshedA1);
  });
});

describe('cardIdsInBand', () => {
  function rect(id: string, left: number, top: number, right: number, bottom: number): CardRect {
    return { id, left, top, right, bottom };
  }

  it('includes a card whose rect overlaps the selection band', () => {
    const rects = [rect('inside', 10, 10, 50, 50)];
    expect(cardIdsInBand(rects, { x: 0, y: 0, w: 100, h: 100 })).toEqual(['inside']);
  });

  it('excludes a card entirely outside the selection band', () => {
    const rects = [rect('outside', 200, 200, 250, 250)];
    expect(cardIdsInBand(rects, { x: 0, y: 0, w: 100, h: 100 })).toEqual([]);
  });

  it('excludes a card that only touches the band edge (no true overlap)', () => {
    // Band spans x:[0,100]; a rect starting exactly at x:100 does not overlap
    // under the strict-inequality intersection test.
    const rects = [rect('touching-edge', 100, 0, 150, 50)];
    expect(cardIdsInBand(rects, { x: 0, y: 0, w: 100, h: 100 })).toEqual([]);
  });
});
