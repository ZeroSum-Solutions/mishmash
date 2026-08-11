// Pure helpers for the Assets page (LibrarySection): SSE merge, box-select
// geometry, date-bucketing, and rail type/source counts. Kept dependency-free
// (no React) so each is unit-testable in isolation.

import type { LibraryAsset } from '@open-design/contracts';
import { badgeKind, primarySource, type BadgeKind } from '../LibraryAssetMeta';

/**
 * Merge freshly-fetched library assets into the current list for an incremental
 * SSE update. Assets already present are refreshed in place (a dedup re-ingest
 * does NOT bump `created_at`, so it must not reorder); genuinely new assets are
 * prepended, latest-first, to match the server's `created_at DESC` order.
 */
export function mergeIngestedAssets(prev: LibraryAsset[], fetched: LibraryAsset[]): LibraryAsset[] {
  if (fetched.length === 0) return prev;
  const byId = new Map(fetched.map((a) => [a.id, a]));
  const present = new Set(prev.map((a) => a.id));
  const merged = prev.map((a) => byId.get(a.id) ?? a);
  const fresh = [...byId.values()].filter((a) => !present.has(a.id)).reverse();
  return fresh.length ? [...fresh, ...merged] : merged;
}

/** Parse `{ assetId }` out of a library SSE `data:` payload, or null. */
export function parseEventAssetId(data: unknown): string | null {
  if (typeof data !== 'string') return null;
  try {
    const parsed = JSON.parse(data) as { assetId?: unknown };
    return typeof parsed.assetId === 'string' ? parsed.assetId : null;
  } catch {
    return null;
  }
}

/** A card's viewport-space box, snapshotted for hit-testing during a drag. */
export interface CardRect {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Snapshot every rendered card's viewport rect (id + bounds) under `grid`. */
export function snapshotCardRects(grid: HTMLElement | null): CardRect[] {
  const out: CardRect[] = [];
  if (!grid) return out;
  grid.querySelectorAll<HTMLElement>('[data-asset-card]').forEach((el) => {
    const id = el.dataset.assetId;
    if (!id) return;
    const r = el.getBoundingClientRect();
    out.push({ id, left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  });
  return out;
}

export interface Band {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Ids of cards whose snapshotted rect intersects the band rectangle. */
export function cardIdsInBand(rects: CardRect[], band: Band): string[] {
  const left = band.x;
  const top = band.y;
  const right = band.x + band.w;
  const bottom = band.y + band.h;
  const ids: string[] = [];
  for (const r of rects) {
    if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) ids.push(r.id);
  }
  return ids;
}

/** Local `YYYY-MM-DD` for a Date — matches the daemon's `archivedDate` bucket. */
export function ymdLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The day bucket an asset belongs to (prefers the daemon's archive date). */
export function dayKeyOf(asset: LibraryAsset): string {
  return asset.archivedDate || ymdLocal(new Date(asset.capturedAt));
}

/** Human heading for a `YYYY-MM-DD` day bucket — Today / Yesterday / a date. */
export function dayHeading(key: string): string {
  const today = ymdLocal(new Date());
  const yesterday = ymdLocal(new Date(Date.now() - 86_400_000));
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Day-bucketed groups (newest day first); items keep their flat `assets` index. */
export function groupByDay(assets: LibraryAsset[]): Array<{ key: string; items: Array<{ asset: LibraryAsset; index: number }> }> {
  const map = new Map<string, Array<{ asset: LibraryAsset; index: number }>>();
  assets.forEach((asset, index) => {
    const key = dayKeyOf(asset);
    const bucket = map.get(key);
    if (bucket) bucket.push({ asset, index });
    else map.set(key, [{ asset, index }]);
  });
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([key, items]) => ({ key, items }));
}

/**
 * Toggle a group of ids in a selection Set: if every id is already selected,
 * the whole group is removed; otherwise the whole group is added. Used by the
 * per-day "select all" checkbox in the date-grouped grid.
 */
export function toggleGroupInSelection(selected: Set<string>, ids: string[]): Set<string> {
  if (!ids.length) return selected;
  const allSelected = ids.every((id) => selected.has(id));
  const next = new Set(selected);
  if (allSelected) ids.forEach((id) => next.delete(id));
  else ids.forEach((id) => next.add(id));
  return next;
}

/** Rail counts — per badge-kind and "generated" source — tallied client-side. */
export interface LibraryRailCounts {
  total: number;
  byKind: Partial<Record<BadgeKind, number>>;
  generated: number;
}

/**
 * Tally rail counts from a snapshot of (ideally unfiltered) assets. Callers
 * pass the most recent unfiltered page the grid has loaded — see
 * `LibrarySection`'s `unfilteredSnapshot` — so counts stay accurate without
 * firing extra requests, at the honest cost of undercounting a kind/source
 * whose matching rows haven't been fetched yet in a library larger than one
 * page (the same known limit the pre-existing `element` filter already has).
 */
export function computeRailCounts(assets: LibraryAsset[]): LibraryRailCounts {
  const byKind: Partial<Record<BadgeKind, number>> = {};
  let generated = 0;
  for (const asset of assets) {
    const bk = badgeKind(asset);
    byKind[bk] = (byKind[bk] ?? 0) + 1;
    if (primarySource(asset) === 'generated') generated += 1;
  }
  return { total: assets.length, byKind, generated };
}
