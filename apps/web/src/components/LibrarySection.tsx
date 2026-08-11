// OD Assets tab — the global asset registry grid.
//
// Shows every asset that has entered the system (clipper capture, manual
// upload, agent task, design-system staging, AI generation) with a source
// badge, a kind badge, and back-links. Captures from the browser extension
// stream in live over the `/api/library/events` SSE feed. The OD Clipper is
// zero-config — it connects automatically whenever Open Design is running
// locally, so there is no pairing step here.
//
// MM-016 restructure: a permanent left rail (search, All Assets, per-kind
// counts, a distinct "Generated" entry, and a Collections placeholder)
// replaces the old kind-filter <select>; the main grid groups by day with a
// per-day bulk-select checkbox; a floating composer at the bottom lets a user
// generate an image without leaving the page. Structure only, per the brief —
// every visual comes from this app's existing tokens/classes, not the
// Higgsfield reference used to plan the layout. See `library/` for the
// extracted sub-components this file composes.
//
// Each card thumbnail is kind-aware (image / video / html / font / color) and
// opens a full-size, kind-aware preview (LibraryPreviewModal) on click. Cards
// are also multi-selectable — checkbox, Cmd/Ctrl+click, Shift+click range, a
// rubber-band box drag, Cmd/Ctrl+A, and now a per-day group checkbox — and the
// selection can be bulk-deleted from the action bar or with Delete / Backspace.
//
// Copy is intentionally inline (not yet i18n-keyed) for pre-existing strings —
// localization of the Library surface is a tracked follow-up. New strings this
// restructure introduces (rail, composer) DO go through the typed i18n dict.

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChatAttachment, DesignSystemSummary, LibraryAsset } from '@open-design/contracts';
import {
  applyLibraryAsset,
  deleteLibraryAsset,
  editLibraryAssetAsPage,
  fetchDesignSystem,
  fetchDesignSystems,
  fetchLibraryAsset,
  fetchLibraryAssetsPage,
  fetchLibraryAssetAsFile,
  generateProjectMedia,
  libraryAssetRawUrl,
  readFileAsDataUrl,
  syncLibrary,
  waitForMediaTask,
  type LibraryAssetQuery,
} from '../providers/registry';
import { createProject } from '../state/projects';
import { navigate } from '../router';
import { setPendingDesignSystemCreateEntry } from '../analytics/ds-create-entry';
import { setComposerSeed, setDesignSystemAssetSeed, setHomeComposerAssetSeed } from '../state/libraryHandoff';
import { Button, Dialog, DialogDescription, DialogFooter, DialogTitle } from '@open-design/components';
import { Icon } from './Icon';
import { useT } from '../i18n';
import { fontFamilyFor, matchesKindFilter, type BadgeKind, type KindFilterValue } from './LibraryAssetMeta';
import { LibraryPreviewModal } from './LibraryPreviewModal';
import { LibraryUploadModal } from './LibraryUploadModal';
import { LibraryCard } from './library/LibraryCard';
import { LibraryRail } from './library/LibraryRail';
import { LibraryGrid } from './library/LibraryGrid';
import { LibraryComposer, type LibraryComposerGenerateInput } from './library/LibraryComposer';
import {
  cardIdsInBand,
  computeRailCounts,
  mergeIngestedAssets,
  parseEventAssetId,
  snapshotCardRects,
  toggleGroupInSelection,
  type Band,
  type CardRect,
} from './library/library-utils';
import styles from './LibrarySection.module.css';

// Re-exported so existing tests importing these pure helpers from
// `./LibrarySection` (their original home) keep working unchanged.
export { cardIdsInBand, mergeIngestedAssets, parseEventAssetId, snapshotCardRects };
export type { Band, CardRect };

interface Props {
  active: boolean;
  /** Open a project, optionally deep-linking to a specific file in the editor. */
  onOpenProject: (projectId: string, fileName?: string) => void;
}

const SOURCE_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All sources' },
  { value: 'clipper', label: 'Clipper' },
  { value: 'manual-upload', label: 'Upload' },
  { value: 'agent-task', label: 'Agent' },
  { value: 'design-system', label: 'Design system' },
  // 'generated' lives in the rail as its own entry now (see LibraryRail) —
  // not duplicated here.
];

// Grid item min-width steps the size slider scrubs through (index 2 matches
// the pre-restructure fixed 180px).
const CARD_SIZE_STEPS_PX = [140, 160, 180, 220, 280];
const DEFAULT_CARD_SIZE_INDEX = 2;

export function LibrarySection({ active, onOpenProject }: Props) {
  const t = useT();
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(false);
  // Pagination (BUG-5): the daemon caps each page at 500/1000 rows, so a
  // larger library needs more than one request. `total`/`hasMore` come
  // straight off the server response so the count shown is never a guess,
  // and `fetchedCountRef` tracks rows fetched so far (pre client-side kind
  // filter) — the offset the next page continues from.
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const fetchedCountRef = useRef(0);
  // The rail needs whole-library counts (per kind + "Generated") independent
  // of whatever filter is currently active. Rather than firing extra
  // requests, we snapshot the assets/total from the most recent UNFILTERED
  // load — free, since kind='' && source==='' is the default view and every
  // filter change/Refresh already re-runs load(). This undercounts a kind
  // whose rows haven't been fetched yet in a library bigger than one page,
  // same known caveat the pre-existing `element` filter already carried.
  const [unfilteredSnapshot, setUnfilteredSnapshot] = useState<LibraryAsset[]>([]);
  const [grandTotal, setGrandTotal] = useState(0);
  // Ref mirrors of `total`/`assets`, kept in sync via effects below, so
  // handlers that fire from outside React's render cycle (the long-lived SSE
  // subscription, delete handlers) can read the current value synchronously
  // instead of closing over a stale one — the same idiom `loadRef` already
  // uses for `load` itself.
  const totalRef = useRef(0);
  const assetsRef = useRef<LibraryAsset[]>([]);
  // Monotonic request generation. `load()` bumps it to start a new "epoch";
  // `loadMore()` reads (without bumping) the epoch it started in. Any async
  // response — from either — is discarded if the epoch has since moved on,
  // so a filter change or Refresh that fires a fresh `load()` while a
  // `loadMore()` page is still in flight can't have that stale page append
  // onto the new grid or clobber total/hasMore/fetchedCountRef.
  const requestIdRef = useRef(0);
  const [syncing, setSyncing] = useState(false);
  const [kind, setKind] = useState('');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  // The input updates `search` instantly (responsive typing) but the server
  // query keys off `debouncedSearch`, so a fast typist fires one request, not
  // one per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [band, setBand] = useState<Band | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [seedFiles, setSeedFiles] = useState<File[] | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const confirmDeleteTitleId = useId();
  // Asset currently being turned into an editable OD page (spinner gate).
  const [editingId, setEditingId] = useState<string | null>(null);
  // Date-grouped ("timeline") is the default main-area layout, matching the
  // restructured target; the flat ungrouped "grid" mode is preserved as a
  // toggle, not dropped.
  const [viewMode, setViewMode] = useState<'grid' | 'timeline'>('timeline');
  const [cardSizeIndex, setCardSizeIndex] = useState(DEFAULT_CARD_SIZE_INDEX);
  const [railCollapsed, setRailCollapsed] = useState(false);
  // "Use in design system" menu state (multi-select → design system).
  const [dsMenuOpen, setDsMenuOpen] = useState(false);
  const [dsList, setDsList] = useState<DesignSystemSummary[]>([]);
  const [dsBusy, setDsBusy] = useState(false);
  const dsLoadedRef = useRef(false);
  const dsMenuWrapRef = useRef<HTMLDivElement>(null);
  const [fileDragActive, setFileDragActive] = useState(false);
  const fileDragDepth = useRef(0);
  const loadedOnce = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<number | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    additive: boolean;
    base: Set<string>;
    moved: boolean;
    rects: CardRect[];
  } | null>(null);

  // Debounce the search box before it touches the network (250ms trailing).
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const query = useMemo<LibraryAssetQuery>(() => {
    const q: LibraryAssetQuery = {};
    // `element` is a badge identity, not a storage kind (element clips are
    // stored as `image`); narrow to images on the server, then split client-side.
    if (kind) q.kind = kind === 'element' ? 'image' : kind;
    if (source) q.source = source;
    if (debouncedSearch.trim()) q.q = debouncedSearch.trim();
    return q;
  }, [kind, source, debouncedSearch]);

  const isUnfilteredView = !kind && !source;

  // Whether any filter narrows the default newest-first feed. Tracked in a ref
  // so the long-lived SSE subscription can read it without resubscribing on
  // every keystroke. When filters are active the SSE handler can't safely
  // predict membership (server `source` is an EXISTS join, `q` is a fuzzy
  // match), so it falls back to a single full reload.
  const filtersActive = !!(kind || source || debouncedSearch.trim());
  const filtersActiveRef = useRef(filtersActive);
  useEffect(() => {
    filtersActiveRef.current = filtersActive;
  }, [filtersActive]);

  useEffect(() => {
    totalRef.current = total;
  }, [total]);
  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  // Fresh page 1 — used on mount, on any filter change, and by the manual
  // Refresh / Sync actions. Resets the paging cursor and starts a new request
  // generation: any `loadMore()` still in flight from before this call will
  // see its own captured generation go stale and discard its response
  // instead of appending old-filter rows onto this fresh grid.
  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    // A fresh load() invalidates any loadMore() page still in flight from the
    // previous view. Clear its loading indicator immediately here rather than
    // relying on that stale request's own `finally` (below, `loadMore()`
    // unconditionally clears `loadingMore` when ITS fetch settles, but if
    // this load() fires while that fetch is still pending, the button would
    // otherwise stay disabled/aria-busy until the stale fetch eventually
    // resolves — which could be a long time, or never).
    setLoadingMore(false);
    setLoading(true);
    try {
      const page = await fetchLibraryAssetsPage(query);
      if (requestIdRef.current !== requestId) return; // superseded by a newer load()
      fetchedCountRef.current = page.assets.length;
      // Final filtering is badge-aware (shared with the picker) so `image` excludes
      // element captures and `element` keeps only them; other kinds pass through.
      const filtered = page.assets.filter((a) => matchesKindFilter(a, kind as KindFilterValue));
      setAssets(filtered);
      setTotal(page.total);
      setHasMore(page.truncated);
      if (isUnfilteredView) {
        setUnfilteredSnapshot(filtered);
        setGrandTotal(page.total);
      }
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }, [query, kind, isUnfilteredView]);

  // Fetch the next page (BUG-5) and append it — the grid never silently caps
  // at the first page's rows. `offset` continues from every row fetched so
  // far, so kind-filtered-out rows on the client don't cause the server page
  // to be re-requested. Reads (rather than bumps) `requestIdRef`: a
  // `loadMore()` continues the CURRENT generation `load()` started, so a
  // fresh `load()` firing mid-flight (filter change, Refresh, Sync) bumps the
  // generation out from under this call and its response is discarded.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const requestId = requestIdRef.current;
    setLoadingMore(true);
    try {
      const page = await fetchLibraryAssetsPage({ ...query, offset: fetchedCountRef.current });
      // Only the DATA-mutating updates are generation-gated — a superseding
      // load() means this page belongs to a view the user has already left,
      // so it must not be appended/counted.
      if (requestIdRef.current !== requestId) return;
      fetchedCountRef.current += page.assets.length;
      const filtered = page.assets.filter((a) => matchesKindFilter(a, kind as KindFilterValue));
      setAssets((prev) => [...prev, ...filtered]);
      setTotal(page.total);
      setHasMore(page.truncated);
      if (isUnfilteredView) {
        setUnfilteredSnapshot((prev) => [...prev, ...filtered]);
        setGrandTotal(page.total);
      }
    } finally {
      // Unconditional: this request's OWN loading indicator must clear when
      // ITS fetch settles regardless of generation, or a superseded call
      // would leave "Load more" stuck disabled/aria-busy forever -- nothing
      // else would ever flip it back (a generation-gated reset here can
      // never fire once superseded, since the check is permanently false).
      setLoadingMore(false);
    }
  }, [query, kind, hasMore, loadingMore, isUnfilteredView]);

  // Force a reconcile (design systems + agent deliverables → referenced Library
  // rows), then reload so the freshly-indexed assets appear. The throttle lives
  // on the daemon; this is the explicit "pull everything in now" action.
  const runSync = useCallback(async () => {
    setSyncing(true);
    try {
      await syncLibrary();
      await load();
    } finally {
      setSyncing(false);
    }
  }, [load]);

  // Fetch when the tab becomes active or filters change.
  useEffect(() => {
    if (!active) return;
    loadedOnce.current = true;
    void load();
  }, [active, load]);

  // Latest `load` for the long-lived SSE subscription to call on fallback,
  // without re-subscribing (which would drop+recreate the EventSource) on every
  // filter change.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  // Shared by every delete path (a card's own delete, bulk delete, and a live
  // SSE delete event) to keep the pagination invariant `total -
  // fetchedCountRef == rows not yet loaded` intact after `removedCount`
  // already-fetched rows are removed. Without this, `total` overstates the
  // library (the deleted rows never leave it) and the next `loadMore()`
  // offset silently skips one row per delete that happened before it — the
  // same class of drift BUG-5 was fixed to prevent, just from the other
  // direction.
  const reconcilePagingAfterRemoval = useCallback((removedCount: number) => {
    if (removedCount <= 0) return;
    fetchedCountRef.current = Math.max(0, fetchedCountRef.current - removedCount);
    const nextTotal = Math.max(0, totalRef.current - removedCount);
    setTotal(nextTotal);
    setHasMore(fetchedCountRef.current < nextTotal);
  }, []);

  // Live updates: clipper captures and deletes patch the grid incrementally.
  // A burst of captures used to trigger one full refetch + full re-render PER
  // event; here events are coalesced over a short window and applied as a
  // targeted merge (fetch the one new asset / drop the one deleted id). When a
  // filter is active — or any per-id fetch is ambiguous — we fall back to a
  // single full reload for that window.
  useEffect(() => {
    if (!active) return;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pendingIngest = new Set<string>();
    const pendingDelete = new Set<string>();
    let pendingFull = false;

    const flush = async () => {
      timer = null;
      // Deletes are free (no fetch); apply them first. Reconcile
      // total/fetchedCountRef/hasMore by however many of the deleted ids were
      // actually present — an id can arrive here for an asset this client
      // never fetched into its current page window, which must not shrink
      // the paging cursor it was never counted in.
      if (pendingDelete.size) {
        const del = new Set(pendingDelete);
        pendingDelete.clear();
        for (const id of del) pendingIngest.delete(id);
        const removedCount = assetsRef.current.reduce((n, a) => (del.has(a.id) ? n + 1 : n), 0);
        setAssets((prev) => prev.filter((a) => !del.has(a.id)));
        reconcilePagingAfterRemoval(removedCount);
      }
      // A filtered view can't predict membership client-side — one reload.
      if (pendingFull || filtersActiveRef.current) {
        pendingFull = false;
        pendingIngest.clear();
        await loadRef.current();
        return;
      }
      if (pendingIngest.size) {
        const ids = [...pendingIngest];
        pendingIngest.clear();
        const fetched = await Promise.all(ids.map((id) => fetchLibraryAsset(id)));
        // A missing fetch is ambiguous (filtered out? race?) — reload instead.
        if (fetched.some((a) => a === null)) {
          await loadRef.current();
          return;
        }
        const resolved = fetched.filter((a): a is LibraryAsset => a !== null);
        // Only genuinely NEW rows (not a dedup re-ingest refreshing an
        // existing card in place) grow the paging cursor/total — otherwise
        // the next loadMore() would double-count and duplicate rows.
        const priorIds = new Set(assetsRef.current.map((a) => a.id));
        const addedCount = resolved.reduce((n, a) => (priorIds.has(a.id) ? n : n + 1), 0);
        setAssets((prev) => mergeIngestedAssets(prev, resolved));
        if (addedCount > 0) {
          fetchedCountRef.current += addedCount;
          setTotal(totalRef.current + addedCount);
          // `hasMore` is unaffected: a live prepend grows total and the
          // fetched cursor by the same amount, so the not-yet-loaded tail
          // (total - fetchedCountRef) — what hasMore answers — is unchanged.
        }
      }
    };

    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => void flush(), 200);
    };

    try {
      es = new EventSource('/api/library/events');
      const onIngest = (ev: MessageEvent) => {
        const id = parseEventAssetId(ev.data);
        if (id) pendingIngest.add(id);
        else pendingFull = true;
        schedule();
      };
      const onDelete = (ev: MessageEvent) => {
        const id = parseEventAssetId(ev.data);
        if (id) pendingDelete.add(id);
        else pendingFull = true;
        schedule();
      };
      es.addEventListener('ingest', onIngest);
      es.addEventListener('delete', onDelete);
    } catch {
      // EventSource unavailable — manual Refresh remains the fallback.
    }
    return () => {
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, [active, reconcilePagingAfterRemoval]);

  // Drop selected ids that no longer exist after a reload / delete. Membership
  // is a single Set lookup so a large grid + large selection stays O(n).
  useEffect(() => {
    setSelectedIds((prev) => {
      if (!prev.size) return prev;
      const live = new Set(assets.map((a) => a.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [assets]);

  const onDelete = useCallback(
    async (id: string) => {
      const ok = await deleteLibraryAsset(id);
      if (!ok) return;
      const wasPresent = assetsRef.current.some((a) => a.id === id);
      setAssets((prev) => prev.filter((a) => a.id !== id));
      reconcilePagingAfterRemoval(wasPresent ? 1 : 0);
    },
    [reconcilePagingAfterRemoval],
  );

  // "Edit as page": turn a captured html asset into a fresh editable OD project
  // and open it on its index.html. The daemon owns the project creation; here we
  // just gate a spinner and navigate on success.
  const handleEditAsPage = useCallback(
    async (assetId: string) => {
      setEditingId(assetId);
      try {
        const result = await editLibraryAssetAsPage(assetId);
        if (result) {
          setPreviewId(null);
          onOpenProject(result.projectId, result.relPath);
        }
      } finally {
        setEditingId(null);
      }
    },
    [onOpenProject],
  );

  const deleteSelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const results = await Promise.all(ids.map((id) => deleteLibraryAsset(id)));
    const deleted = new Set(ids.filter((_, i) => results[i]));
    if (!deleted.size) return;
    const removedCount = assetsRef.current.reduce((n, a) => (deleted.has(a.id) ? n + 1 : n), 0);
    setAssets((prev) => prev.filter((a) => !deleted.has(a.id)));
    reconcilePagingAfterRemoval(removedCount);
    setSelectedIds(new Set());
    setPreviewId((cur) => (cur && deleted.has(cur) ? null : cur));
  }, [selectedIds, reconcilePagingAfterRemoval]);

  // Bulk delete is destructive and easy to trigger (a button or Delete/
  // Backspace), so it routes through a confirmation dialog instead of removing
  // the selection immediately.
  const requestDeleteSelected = useCallback(() => {
    if (selectedIds.size) setConfirmDeleteOpen(true);
  }, [selectedIds]);

  const confirmDeleteSelected = useCallback(() => {
    setConfirmDeleteOpen(false);
    void deleteSelected();
  }, [deleteSelected]);

  // --- multi-select → design system ---------------------------------------

  // Lazily load the user's own (editable) design systems the first time the
  // "Use in design system" menu opens — these are the ones that can be refined.
  useEffect(() => {
    if (!dsMenuOpen || dsLoadedRef.current) return;
    dsLoadedRef.current = true;
    void fetchDesignSystems().then((list) => setDsList(list.filter((d) => d.source === 'user')));
  }, [dsMenuOpen]);

  // Dismiss the menu on outside click / Escape. Deliberately NOT a full-screen
  // backdrop element: a stray bare overlay can paint opaque (e.g. UA button
  // styling) and blank the whole page behind it.
  useEffect(() => {
    if (!dsMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!dsMenuWrapRef.current?.contains(e.target as Node)) setDsMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDsMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [dsMenuOpen]);

  // Path A: open the create-design-system flow pre-seeded with the selected
  // assets as source material (fetched into File objects via a hand-off store).
  const createDesignSystemFromSelection = useCallback(async () => {
    const chosen = assets.filter((a) => selectedIds.has(a.id));
    if (!chosen.length) return;
    setDsBusy(true);
    try {
      const files = (await Promise.all(chosen.map((a) => fetchLibraryAssetAsFile(a)))).filter(
        (f): f is File => f !== null,
      );
      // All fetches failed: don't ferry the user into a design-system-create
      // flow seeded with zero files, which looks identical to never having
      // selected anything. Leave the selection in place so they can retry.
      if (!files.length) return;
      setDesignSystemAssetSeed({ files });
      setDsMenuOpen(false);
      setSelectedIds(new Set());
      setPendingDesignSystemCreateEntry('library');
      navigate({ kind: 'design-system-create' });
    } finally {
      setDsBusy(false);
    }
  }, [assets, selectedIds]);

  // "Chat to design": fetch the selected assets into File objects, hand them to
  // the Home chat composer, and navigate there. The user lands in the creation
  // composer with the assets staged, describes what to build, and Runs to spawn
  // a new project — the assets ride the normal upload-on-Run path. Mirrors the
  // create-design-system File hand-off above, but the destination is Home.
  const chatToDesignFromSelection = useCallback(async () => {
    const chosen = assets.filter((a) => selectedIds.has(a.id));
    if (!chosen.length) return;
    setDsBusy(true);
    try {
      const files = (await Promise.all(chosen.map((a) => fetchLibraryAssetAsFile(a)))).filter(
        (f): f is File => f !== null,
      );
      if (!files.length) return;
      setHomeComposerAssetSeed({ files });
      setSelectedIds(new Set());
      navigate({ kind: 'home', view: 'home' });
    } finally {
      setDsBusy(false);
    }
  }, [assets, selectedIds]);

  // Path B: copy the selected assets into an existing design system's project,
  // stage a composer seed (query + the copied assets as attachments), and open
  // that project so the user can review and Send to refine the system.
  const optimizeExistingDesignSystem = useCallback(
    async (ds: DesignSystemSummary) => {
      const chosen = assets.filter((a) => selectedIds.has(a.id));
      if (!chosen.length) return;
      setDsBusy(true);
      try {
        let projectId = ds.projectId;
        if (!projectId) {
          const detail = await fetchDesignSystem(ds.id);
          projectId = detail?.projectId;
        }
        if (!projectId) {
          setDsMenuOpen(false);
          return;
        }
        const attachments: ChatAttachment[] = [];
        // Track how many assets actually landed, not `chosen.length` — some
        // `applyLibraryAsset` calls can fail (transient error, an asset
        // deleted mid-flight), and the auto-sent message must not claim more
        // references were added than actually were.
        let appliedCount = 0;
        for (const a of chosen) {
          const res = await applyLibraryAsset(a.id, projectId, undefined, { includeElement: true });
          if (res?.relPath) {
            appliedCount += 1;
            attachments.push({
              path: res.relPath,
              name: res.relPath.split('/').pop() || res.relPath,
              kind: a.kind === 'image' ? 'image' : 'file',
            });
          }
          // An element-pick capture also brings its markup; stage it so the
          // design-system refinement can read the element's HTML, not just the
          // screenshot.
          if (res?.elementRelPath) {
            attachments.push({
              path: res.elementRelPath,
              name: res.elementRelPath.split('/').pop() || res.elementRelPath,
              kind: 'file',
            });
          }
        }
        const n = appliedCount;
        const text =
          n > 0
            ? `Use ${n} reference${n > 1 ? 's' : ''} I just added from my Assets to refine this design ` +
              `system — pull the palette, typography, and component patterns that fit and update the design tokens.`
            : 'Refine this design system — pull the palette, typography, and component patterns that fit and update the design tokens.';
        setComposerSeed({ projectId, text, attachments });
        setDsMenuOpen(false);
        setSelectedIds(new Set());
        onOpenProject(projectId);
      } finally {
        setDsBusy(false);
      }
    },
    [assets, selectedIds, onOpenProject],
  );

  const toggleOne = useCallback((id: string, index: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorRef.current = index;
  }, []);

  const rangeTo = useCallback(
    (index: number) => {
      const anchor = anchorRef.current ?? index;
      const lo = Math.min(anchor, index);
      const hi = Math.max(anchor, index);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = lo; i <= hi; i++) {
          const a = assets[i];
          if (a) next.add(a.id);
        }
        return next;
      });
    },
    [assets],
  );

  const selectAll = useCallback(() => setSelectedIds(new Set(assets.map((a) => a.id))), [assets]);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const toggleGroupSelection = useCallback(
    (ids: string[]) => setSelectedIds((prev) => toggleGroupInSelection(prev, ids)),
    [],
  );

  // --- rail: search / kind / generated selection ---------------------------
  const selectAllRail = useCallback(() => {
    setKind('');
    setSource('');
  }, []);
  const selectRailKind = useCallback((k: BadgeKind) => {
    setSource('');
    setKind(k);
  }, []);
  const selectGeneratedRail = useCallback(() => {
    setKind('');
    setSource('generated');
  }, []);
  const railCounts = useMemo(() => computeRailCounts(unfilteredSnapshot), [unfilteredSnapshot]);

  // --- composer: generate an image without leaving the gallery -------------
  //
  // Wired to the EXISTING direct media-generate route (generateProjectMedia →
  // POST /api/projects/:id/media/generate, the same dispatcher `od media
  // generate` and the chat agent's tool token both use) — no new daemon
  // capability. It needs a projectId, and Assets isn't project-scoped, so a
  // small project is created to host the generation, exactly like the Home
  // composer's "start a blank project" path already does for a from-scratch
  // creation. See `generateProjectMedia`'s docblock for the one known
  // fidelity gap this reuse carries: the resulting asset syncs into the
  // Library as `manual-upload`, not `generated`, because that classification
  // is driven by chat-conversation attribution a direct API call has none of.
  const generateFromComposer = useCallback(
    async (input: LibraryComposerGenerateInput): Promise<{ ok: boolean; message?: string }> => {
      try {
        const { project } = await createProject({
          name: input.prompt.slice(0, 60) || 'Generated image',
          skillId: null,
          designSystemId: null,
        });
        const image = input.attachment ? await readFileAsDataUrl(input.attachment) : undefined;
        const task = await generateProjectMedia(project.id, {
          surface: 'image',
          model: input.model,
          prompt: input.prompt,
          aspect: input.aspect,
          ...(image ? { image } : {}),
        });
        if (!task) return { ok: false, message: 'Could not start generation.' };
        const snap = await waitForMediaTask(task.taskId, { totalBudgetMs: 5 * 60 * 1000 });
        if (snap.status !== 'done') {
          return { ok: false, message: snap.error?.message || 'Generation failed.' };
        }
        await syncLibrary();
        await load();
        return { ok: true };
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : 'Could not generate that image.' };
      }
    },
    [load],
  );

  // --- file upload (drop-anywhere + Upload button) -------------------------
  const openUpload = useCallback((files?: File[]) => {
    setSeedFiles(files && files.length ? files : null);
    setUploadOpen(true);
  }, []);

  // A drag carrying OS files anywhere over the section reveals a drop overlay;
  // dropping seeds the upload modal. enter/leave are depth-counted so child
  // elements don't flicker the overlay. Pure-internal drags (rubber-band box
  // select) never set the `Files` type, so they don't trigger this.
  const dragHasFiles = (e: React.DragEvent) => e.dataTransfer?.types?.includes('Files');
  const onSectionDragEnter = useCallback((e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    fileDragDepth.current += 1;
    setFileDragActive(true);
  }, []);
  const onSectionDragOver = useCallback((e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);
  const onSectionDragLeave = useCallback((e: React.DragEvent) => {
    if (!dragHasFiles(e)) return;
    fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
    if (fileDragDepth.current === 0) setFileDragActive(false);
  }, []);
  const onSectionDrop = useCallback(
    (e: React.DragEvent) => {
      if (!dragHasFiles(e)) return;
      e.preventDefault();
      fileDragDepth.current = 0;
      setFileDragActive(false);
      const files = Array.from(e.dataTransfer.files ?? []);
      if (files.length) openUpload(files);
    },
    [openUpload],
  );

  // --- box selection (rubber band) ----------------------------------------
  const onGridMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // Starting on a card is a click / preview gesture, not a box select.
      if (target.closest('[data-asset-card]')) return;
      const additive = e.metaKey || e.ctrlKey || e.shiftKey;
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        additive,
        base: new Set(additive ? selectedIds : []),
        moved: false,
        // Snapshot every card's box ONCE here, while the whole grid is laid out
        // (content-visibility reserves the same box for off-screen cards). The
        // move handler then hit-tests these cached rects instead of forcing a
        // querySelectorAll + getBoundingClientRect reflow on every mouse move.
        rects: snapshotCardRects(gridRef.current),
      };
      setBand({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
      setDragging(true);
    },
    [selectedIds],
  );

  useEffect(() => {
    if (!dragging) return;
    let raf = 0;
    let lastX = dragRef.current?.startX ?? 0;
    let lastY = dragRef.current?.startY ?? 0;

    const apply = () => {
      raf = 0;
      const d = dragRef.current;
      if (!d) return;
      const nextBand: Band = {
        x: Math.min(d.startX, lastX),
        y: Math.min(d.startY, lastY),
        w: Math.abs(lastX - d.startX),
        h: Math.abs(lastY - d.startY),
      };
      setBand(nextBand);
      const next = new Set(d.base);
      // `.band` is position:fixed, so the snapshotted viewport rects and the
      // band share a coordinate space; the scroll handler re-snapshots so the
      // selection still tracks content that scrolls under a stationary band.
      for (const id of cardIdsInBand(d.rects, nextBand)) next.add(id);
      setSelectedIds(next);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const move = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      d.moved = true;
      lastX = e.clientX;
      lastY = e.clientY;
      schedule();
    };
    const onScroll = () => {
      const d = dragRef.current;
      if (!d) return;
      d.rects = snapshotCardRects(gridRef.current);
      schedule();
    };
    const up = () => {
      const d = dragRef.current;
      // A click on empty space (no drag) clears the selection.
      if (d && !d.moved && !d.additive) setSelectedIds(new Set());
      dragRef.current = null;
      setDragging(false);
      setBand(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    // Capture so a scrolling inner pane (not just the window) re-snapshots.
    window.addEventListener('scroll', onScroll, true);
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('scroll', onScroll, true);
      document.body.style.userSelect = prevUserSelect;
    };
  }, [dragging]);

  // --- keyboard shortcuts --------------------------------------------------
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      // The upload modal, delete-confirm dialog, and the design-system menu own
      // shortcuts while open.
      if (uploadOpen || confirmDeleteOpen || dsMenuOpen) return;
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) {
        if (typing || !assets.length) return;
        e.preventDefault();
        selectAll();
      } else if (e.key === 'Escape') {
        if (previewId) return; // the preview modal owns Escape while it's open
        if (selectedIds.size) setSelectedIds(new Set());
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (typing || previewId || !selectedIds.size) return;
        e.preventDefault();
        requestDeleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, assets, selectedIds, previewId, uploadOpen, confirmDeleteOpen, dsMenuOpen, selectAll, requestDeleteSelected]);

  // `@font-face` rules for every font asset on screen, so both the grid
  // thumbnails and the preview specimen render in the real typeface.
  const fontFaceCss = useMemo(
    () =>
      assets
        .filter((a) => a.kind === 'font')
        .map(
          (a) =>
            `@font-face{font-family:"${fontFamilyFor(a.id)}";src:url("${libraryAssetRawUrl(
              a.id,
            )}");font-display:swap;}`,
        )
        .join('\n'),
    [assets],
  );

  const previewIndex = previewId ? assets.findIndex((a) => a.id === previewId) : -1;
  const previewAsset = previewIndex >= 0 ? assets[previewIndex] : null;
  const selectedCount = selectedIds.size;
  // The `element` filter queries the server as `kind:'image'` (element clips
  // have no storage kind of their own) then splits client-side, so the
  // server's `total`/`truncated` count ALL images, not just elements —
  // showing them here would overstate the count, and "Load more" could fetch
  // an entire page of non-element images that renders nothing. Suppressing
  // the affordance for this one pseudo-kind keeps every real kind fully
  // paginated while being honest that `element` isn't (yet).
  const showLoadMore = hasMore && kind !== 'element';

  // Render one memoized card. The wrapper just wires this render's per-card
  // props; `LibraryCard` itself is what skips re-rendering when only another
  // card's selection changed.
  const renderCard = (asset: LibraryAsset, index: number) => (
    <LibraryCard
      key={asset.id}
      asset={asset}
      index={index}
      selected={selectedIds.has(asset.id)}
      selecting={selectedCount > 0}
      editing={editingId === asset.id}
      onToggle={toggleOne}
      onRange={rangeTo}
      onPreview={setPreviewId}
      onDelete={onDelete}
      onEditAsPage={handleEditAsPage}
      onOpenProject={onOpenProject}
    />
  );

  return (
    <div
      className={`entry-section ${styles.root}`}
      onDragEnter={onSectionDragEnter}
      onDragOver={onSectionDragOver}
      onDragLeave={onSectionDragLeave}
      onDrop={onSectionDrop}
    >
      {fontFaceCss ? <style>{fontFaceCss}</style> : null}
      <header className="entry-section__head">
        <h1 className="entry-section__title">Assets</h1>
        <div className={styles.clipperHint}>
          <p className={styles.headerHint}>
            Clip any page, design system, screenshot, image, or Figma import JSON into your Assets —
            local-first, one click, no login.
          </p>
          <a
            className={styles.clipperDownload}
            href="https://open-design.ai/clipper"
            target="_blank"
            rel="noreferrer"
          >
            <Icon name="download" size={15} />
            Get the MishMash Web Clipper
          </a>
        </div>
      </header>

      <div className={styles.layout} data-rail-collapsed={railCollapsed ? 'true' : 'false'}>
        {railCollapsed ? null : (
          <LibraryRail
            search={search}
            onSearchChange={setSearch}
            activeKind={kind}
            activeGenerated={source === 'generated'}
            onSelectAll={selectAllRail}
            onSelectKind={selectRailKind}
            onSelectGenerated={selectGeneratedRail}
            grandTotal={grandTotal}
            counts={railCounts}
          />
        )}

        <div className={styles.main}>
          <div className={styles.toolbar}>
            <select
              aria-label="Filter by source"
              className={styles.select}
              value={source === 'generated' ? '' : source}
              onChange={(e) => setSource(e.target.value)}
            >
              {SOURCE_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <div className={styles.viewToggle} role="group" aria-label="View mode">
              <button
                type="button"
                className={`${styles.viewToggleBtn} od-tooltip`}
                data-active={viewMode === 'grid' ? 'true' : 'false'}
                aria-pressed={viewMode === 'grid'}
                onClick={() => setViewMode('grid')}
                data-tooltip="Show assets as a flat grid"
                data-tooltip-placement="bottom"
              >
                Grid
              </button>
              <button
                type="button"
                className={`${styles.viewToggleBtn} od-tooltip`}
                data-active={viewMode === 'timeline' ? 'true' : 'false'}
                aria-pressed={viewMode === 'timeline'}
                onClick={() => setViewMode('timeline')}
                data-tooltip="Group assets by day, newest first"
                data-tooltip-placement="bottom"
              >
                Timeline
              </button>
            </div>
            <div className={styles.sizeSliderWrap}>
              <Icon name="zoom-out" size={13} className={styles.sizeSliderIcon} />
              <input
                type="range"
                className={styles.sizeSlider}
                min={0}
                max={CARD_SIZE_STEPS_PX.length - 1}
                step={1}
                value={cardSizeIndex}
                aria-label={t('library.sizeSlider')}
                onChange={(e) => setCardSizeIndex(Number(e.target.value))}
              />
              <Icon name="zoom-in" size={13} className={styles.sizeSliderIcon} />
            </div>
            <button
              type="button"
              className={`${styles.expandBtn} od-tooltip`}
              aria-pressed={railCollapsed}
              onClick={() => setRailCollapsed((v) => !v)}
              data-tooltip={railCollapsed ? t('library.collapseRail') : t('library.expandGrid')}
              data-tooltip-placement="bottom"
            >
              <Icon name="panel-left" size={15} />
            </button>
            <Button
              variant="ghost"
              className={`${styles.refreshBtn} od-tooltip`}
              onClick={() => void load()}
              aria-busy={loading}
              data-tooltip="Reload the list with the current filters"
              data-tooltip-placement="bottom"
            >
              <Icon name="refresh" size={15} className={loading ? styles.spin : undefined} />
              Refresh
            </Button>
            <Button
              variant="ghost"
              className={`${styles.refreshBtn} od-tooltip`}
              onClick={() => void runSync()}
              aria-busy={syncing}
              disabled={syncing}
              data-tooltip="Pull your design systems and agent-generated artifacts into Assets"
              data-tooltip-placement="bottom"
            >
              <Icon name="refresh" size={15} className={syncing ? styles.spin : undefined} />
              {syncing ? 'Syncing…' : 'Sync'}
            </Button>
            <Button
              className={`${styles.uploadBtn} od-tooltip`}
              onClick={() => openUpload()}
              data-tooltip="Upload images, fonts, or files into Assets"
              data-tooltip-placement="bottom"
            >
              <Icon name="upload" size={15} />
              Upload
            </Button>
          </div>

          {selectedCount > 0 && !dragging ? (
            <div className={styles.selectionBar}>
              <span className={styles.selectionCount}>{selectedCount} selected</span>
              <button type="button" className={styles.selectionLink} onClick={selectAll}>
                Select all
              </button>
              <button type="button" className={styles.selectionLink} onClick={clearSelection}>
                Clear
              </button>
              <span className={styles.selectionSpacer} />
              <button
                type="button"
                className={styles.chatBtn}
                onClick={() => void chatToDesignFromSelection()}
                disabled={dsBusy}
                title={`Start a chat to turn ${selectedCount} into a design`}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                Chat to design
              </button>
              <div className={styles.dsMenuWrap} ref={dsMenuWrapRef}>
                <button
                  type="button"
                  className={styles.dsMenuBtn}
                  onClick={() => setDsMenuOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={dsMenuOpen}
                  disabled={dsBusy}
                >
                  {dsBusy ? 'Working…' : 'Use in design system'}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {dsMenuOpen ? (
                  <div className={styles.dsMenu} role="menu">
                    <button
                      type="button"
                      className={styles.dsMenuItem}
                      role="menuitem"
                      onClick={() => void createDesignSystemFromSelection()}
                    >
                      <span className={styles.dsMenuItemTitle}>Create new design system</span>
                      <span className={styles.dsMenuItemSub}>
                        Open the create flow with these {selectedCount} attached
                      </span>
                    </button>
                    <div className={styles.dsMenuDivider} />
                    <div className={styles.dsMenuHeader}>Refine existing</div>
                    {dsList.length === 0 ? (
                      <div className={styles.dsMenuEmpty}>No editable design systems yet.</div>
                    ) : (
                      dsList.map((ds) => (
                        <button
                          key={ds.id}
                          type="button"
                          className={styles.dsMenuItem}
                          role="menuitem"
                          onClick={() => void optimizeExistingDesignSystem(ds)}
                        >
                          <span className={styles.dsMenuItemTitle}>{ds.title}</span>
                          <span className={styles.dsMenuItemSub}>Add assets & open to refine</span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
              <button type="button" className={styles.selectionDelete} onClick={requestDeleteSelected}>
                Delete {selectedCount}
              </button>
            </div>
          ) : null}

          {loading && assets.length === 0 ? (
            <p className={styles.empty}>Loading…</p>
          ) : assets.length === 0 ? (
            <div className={styles.empty}>
              <p>No assets yet.</p>
              <p className={styles.emptyHint}>
                Clip from any page with the MishMash Web Clipper, run{' '}
                <code>od library import &lt;file&gt;</code>, or upload inside a project — everything
                lands here.
              </p>
            </div>
          ) : (
            <div style={{ ['--library-card-min' as string]: `${CARD_SIZE_STEPS_PX[cardSizeIndex]}px` }}>
              <h2 className={styles.gridHeading}>All assets</h2>
              <LibraryGrid
                viewMode={viewMode}
                assets={assets}
                gridRef={gridRef}
                onMouseDown={onGridMouseDown}
                selecting={selectedCount > 0}
                selectedIds={selectedIds}
                onToggleGroup={toggleGroupSelection}
                renderCard={renderCard}
              />
            </div>
          )}

          {showLoadMore ? (
            <div className={styles.loadMoreRow}>
              {/* aria-live: this text changes after every Load more click (the
                  shown count grows), so a screen-reader user gets an announcement
                  instead of silence — the same "never silently present a
                  truncated set" principle BUG-5 fixed, applied to a11y. */}
              <span className={styles.loadMoreCount} aria-live="polite">
                {t('library.assetCount', { shown: assets.length, total })}
              </span>
              <Button variant="ghost" onClick={() => void loadMore()} disabled={loadingMore} aria-busy={loadingMore}>
                {loadingMore ? t('library.loadingMore') : t('library.loadMore')}
              </Button>
            </div>
          ) : null}

          {/* Always available, even on an empty library — generating the
              first asset is a legitimate entry point, not just a follow-up
              action once assets already exist. */}
          <LibraryComposer onGenerate={generateFromComposer} />
        </div>
      </div>

      {band ? (
        <div
          className={styles.band}
          style={{ left: band.x, top: band.y, width: band.w, height: band.h }}
        />
      ) : null}

      {fileDragActive ? (
        <div className={styles.dropOverlay} aria-hidden>
          <div className={styles.dropOverlayInner}>
            <Icon name="upload" size={30} />
            <span className={styles.dropOverlayText}>Drop to upload to Assets</span>
          </div>
        </div>
      ) : null}

      {uploadOpen ? (
        <LibraryUploadModal
          seedFiles={seedFiles}
          onClose={() => {
            setUploadOpen(false);
            setSeedFiles(null);
          }}
          onUploaded={load}
        />
      ) : null}

      {confirmDeleteOpen ? (
        <Dialog
          className="modal-confirm"
          role="alertdialog"
          onClose={() => setConfirmDeleteOpen(false)}
          closeOnEscape
          ariaLabelledBy={confirmDeleteTitleId}
        >
          <DialogTitle id={confirmDeleteTitleId}>
            Delete {selectedCount} {selectedCount === 1 ? 'asset' : 'assets'}?
          </DialogTitle>
          <DialogDescription className="modal-confirm-message">
            This permanently removes {selectedCount === 1 ? 'it' : 'them'} from your Assets. This
            can’t be undone.
          </DialogDescription>
          <DialogFooter className="row">
            <button type="button" onClick={() => setConfirmDeleteOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary danger" autoFocus onClick={confirmDeleteSelected}>
              Delete {selectedCount}
            </button>
          </DialogFooter>
        </Dialog>
      ) : null}

      {previewAsset ? (
        <LibraryPreviewModal
          asset={previewAsset}
          hasPrev={previewIndex > 0}
          hasNext={previewIndex >= 0 && previewIndex < assets.length - 1}
          onPrev={() => {
            const prev = assets[previewIndex - 1];
            if (prev) setPreviewId(prev.id);
          }}
          onNext={() => {
            const next = assets[previewIndex + 1];
            if (next) setPreviewId(next.id);
          }}
          onClose={() => setPreviewId(null)}
          onDelete={(id) => {
            void onDelete(id);
            setPreviewId(null);
          }}
          onOpenProject={onOpenProject}
          onEditAsPage={handleEditAsPage}
        />
      ) : null}
    </div>
  );
}
