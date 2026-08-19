// Design Library tab — browse of the local curated reference-asset library
// (apps/daemon/src/routes/design-library.ts serves it from
// ~/Desktop/Design Assets, or OD_DESIGN_LIBRARY_DIR). Every collection is
// rights-gated via `allowed_use`; "Open file" (opens the collection folder in
// Finder; button copy renamed under MM-011) is always offered, and
// "Start project" (copies the kit's files into a new project) is offered
// ONLY for the two copyable tiers, own-code and licensed-source-review —
// every other tier stays browse/open-only, so a restricted item can never
// leak into a project this way.
//
// The catalog is fetched once, lazily, the first time this tab becomes
// active — not on app mount.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from '@open-design/components';
import type {
  DesignLibraryAllowedUse,
  DesignLibraryGroup,
  DesignLibraryItem,
  GuidedCreateBrief,
  Project,
} from '@open-design/contracts';
import {
  designLibraryPreviewAssetUrl,
  designLibraryThumbUrl,
  fetchDesignLibraryCatalog,
  openDesignLibraryLivePreview,
  openDesignLibraryPath,
  startDesignLibraryProject,
  type DesignLibraryCatalogResult,
} from '../providers/registry';
import { Icon } from './Icon';
import { MediaFallback } from './MediaFallback';
import { DesignLibraryPromotionPanel } from './DesignLibraryPromotionPanel';
import { GuidedCreateDialog } from './GuidedCreateDialog';
import { useInView } from './plugins-home/useInView';
import { useT } from '../i18n';
import styles from './DesignLibrarySection.module.css';

// Adds the group-local hidden-duplicate count computed above; render-only,
// never sent to or received from the daemon.
type RenderableGroup = DesignLibraryGroup & { hiddenDuplicateCount: number };

/**
 * `project` is the daemon's full record for the just-started project —
 * `startDesignLibraryProject`'s response already carries it, including any
 * guided-create brief folded into `pendingPrompt` server-side (MM-008). The
 * host needs the whole record (not just the id) to register it in its
 * client-side project cache and arm auto-send before navigating, instead of
 * routing to a project the client has never seen and landing on a dead
 * canvas.
 */
export type DesignLibraryOpenProjectHandler = (
  projectId: string,
  conversationId?: string,
  entryFile?: string,
  project?: Project,
) => void;

interface Props {
  active: boolean;
  /**
   * Omit to hide "Use as template" entirely (e.g. no project-navigation host).
   * `entryFile` is the daemon-detected entry HTML of the copied kit; the host
   * opens it so the new project lands on the same page the live preview
   * showed instead of whatever the generic primary-file heuristic picks.
   */
  onOpenProject?: DesignLibraryOpenProjectHandler;
}

// Only these allowed_use tiers may be copied into a new project — mirrors
// COPYABLE_ALLOWED_USE in apps/daemon/src/routes/design-library.ts.
const COPYABLE_ALLOWED_USE = new Set<DesignLibraryAllowedUse>(['own-code', 'licensed-source-review']);
const REFERENCEABLE_ALLOWED_USE = new Set<DesignLibraryAllowedUse>([
  'own-code',
  'licensed-source-review',
  'human-local-only',
]);

const ALLOWED_USE_TOOLTIP_KEY = {
  'own-code': 'designLibrary.allowedUse.ownCode',
  'licensed-source-review': 'designLibrary.allowedUse.licensedSourceReview',
  'human-local-only': 'designLibrary.allowedUse.humanLocalOnly',
  'blocked-pending-license': 'designLibrary.allowedUse.blockedPendingLicense',
} as const satisfies Record<DesignLibraryAllowedUse, string>;

function allowedUseLabel(value: DesignLibraryAllowedUse): string {
  return value
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function categoryLabel(category: string): string {
  return category
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// "Explore kit" (t7/PRD C7): only categories that are actually a runnable
// interface — a screenshot set or a single landing page has nothing to
// interact with — and only on the same copyable tiers live-preview already
// uses (rendering runs the author's scripts). Mirrors
// LIVE_PREVIEWABLE_ALLOWED_USE in apps/daemon/src/routes/design-library.ts;
// the preview-asset route re-authorizes independently, same as live-preview.
const EXPLORABLE_CATEGORIES = new Set(['ui-kit', 'design-system']);
function canExploreKit(item: DesignLibraryItem): boolean {
  return Boolean(item.entry_html) && EXPLORABLE_CATEGORIES.has(item.category) && COPYABLE_ALLOWED_USE.has(item.allowed_use);
}

// Shared with `useLivePreview` below and the MM-012#1 detail-dialog preview
// pane: an item is only ever rendered live (OS browser or the in-app
// preview-asset iframe) on the same copyable tiers, regardless of surface —
// rendering runs the author's scripts, so third-party captures stay
// open-file-only. The preview-asset route re-authorizes independently.
function canLivePreviewItem(item: DesignLibraryItem): boolean {
  return Boolean(item.entry_html) && COPYABLE_ALLOWED_USE.has(item.allowed_use);
}

// Real strip images only — falls back to the primary thumb alone when the
// catalog has no `gallery` (older daemon) or reports none beyond the cover.
function galleryImages(item: DesignLibraryItem): string[] {
  if (item.gallery && item.gallery.length > 0) return item.gallery;
  return item.thumb ? [item.thumb] : [];
}

// MM-015 — TEMPORARY pin: NeuForm groups render ahead of the normal
// alphabetical design-system ordering, even though design systems would
// otherwise sort first. Owner's ask verbatim: "even though design systems
// alphabetically should run first ... we just tag them to the top." This is
// a stopgap while every other design-library source's ingestion pipeline is
// broken (MM-013) — NeuForm is the one tier that currently imports with
// intact previews and metadata (see mm015-diagnostic.md). Revisit and
// remove this pin once MM-013 lands and the other sources are trustworthy
// enough that alphabetical ordering is acceptable again. This is a targeted
// stable partition, not a new ranking system — every other group keeps its
// catalog-supplied (alphabetical) relative order.
//
// Matches the folder prefix apps/daemon/scripts/import-neuform-favorites.ts
// writes for every NeuForm group (`CATEGORY_META[...].folder`). Duplicated
// here rather than imported: apps/web must not import apps/daemon/src/**.
const NEUFORM_GROUP_FOLDER_PREFIX = '05 NeuForm Favorites';

function isNeuFormGroup(folder: string): boolean {
  return (
    folder === NEUFORM_GROUP_FOLDER_PREFIX || folder.startsWith(`${NEUFORM_GROUP_FOLDER_PREFIX}/`)
  );
}

function pinNeuFormGroupsFirst<T extends { folder: string }>(groups: T[]): T[] {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const group of groups) {
    (isNeuFormGroup(group.folder) ? pinned : rest).push(group);
  }
  return [...pinned, ...rest];
}

export function DesignLibrarySection({ active, onOpenProject }: Props) {
  const t = useT();
  const [result, setResult] = useState<DesignLibraryCatalogResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [domain, setDomain] = useState('');
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    if (!active || hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    setLoading(true);
    fetchDesignLibraryCatalog().then((next) => {
      setResult(next);
      setLoading(false);
    });
  }, [active]);

  const catalog = result?.ok ? result.catalog : null;

  const categories = useMemo(
    () => catalog?.groups.map((group) => ({ title: group.title, folder: group.folder })) ?? [],
    [catalog],
  );

  const domainCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of catalog?.groups ?? []) {
      for (const item of group.items) {
        for (const d of item.domains) {
          counts.set(d, (counts.get(d) ?? 0) + 1);
        }
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [catalog]);

  const { primaryGroups, humanLocalGroups } = useMemo(() => {
    if (!catalog) return { primaryGroups: [], humanLocalGroups: [] };
    const query = search.trim().toLowerCase();
    const matchingGroups = catalog.groups
      .filter((group) => !category || group.folder === category)
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (domain && !item.domains.includes(domain)) return false;
          if (
            query &&
            !item.label.toLowerCase().includes(query) &&
            !(item.description ?? '').toLowerCase().includes(query) &&
            !item.domains.some((value) => value.toLowerCase().includes(query)) &&
            !(item.aspects ?? []).some((value) => value.toLowerCase().includes(query)) &&
            !(item.stacks ?? []).some((value) => value.toLowerCase().includes(query))
          ) {
            return false;
          }
          return true;
        }),
      }))
      .filter((group) => group.items.length > 0);

    // Stable-partition restricted references after every other result while
    // retaining the catalog's group and item order inside each partition.
    // A mixed source group appears once in the primary results and once in
    // the clearly labeled reference-only section rather than interleaving
    // Human Local Only cards with project-ready options.
    const primaryGroups: RenderableGroup[] = [];
    const humanLocalGroups: RenderableGroup[] = [];
    for (const group of matchingGroups) {
      // Duplicate suppression (t9): a catalog item carrying `duplicate_of`
      // is hidden from the grid by default. Filtered here, before the
      // allowed_use partition below, so a hidden duplicate never counts
      // toward either section's items.
      const visibleItems = group.items.filter((item) => !item.duplicate_of);
      const hiddenDuplicateCount = group.items.length - visibleItems.length;
      const primaryItems = visibleItems.filter((item) => item.allowed_use !== 'human-local-only');
      const humanLocalItems = visibleItems.filter((item) => item.allowed_use === 'human-local-only');
      if (primaryItems.length > 0) primaryGroups.push({ ...group, items: primaryItems, hiddenDuplicateCount });
      if (humanLocalItems.length > 0) humanLocalGroups.push({ ...group, items: humanLocalItems, hiddenDuplicateCount });
    }
    // MM-015 pin: see pinNeuFormGroupsFirst above for why this exception
    // exists and when to remove it.
    return { primaryGroups: pinNeuFormGroupsFirst(primaryGroups), humanLocalGroups: pinNeuFormGroupsFirst(humanLocalGroups) };
  }, [catalog, search, category, domain]);

  const hasAnyItems = primaryGroups.length > 0 || humanLocalGroups.length > 0;
  const collectionCount = useMemo(
    () => catalog?.groups.reduce((total, group) => total + group.items.length, 0) ?? 0,
    [catalog],
  );

  return (
    <div className={`entry-section ${styles.root}`}>
      <header className="entry-section__head">
        <h1 className="entry-section__title">{catalog?.library || t('designLibrary.title')}</h1>
        {catalog ? (
          <div className={styles.headerMeta}>
            <span className={styles.collectionsCount}>{catalog.total_collections} collections</span>
            <p className={styles.rightsNote}>{t('designLibrary.rightsNote')}</p>
          </div>
        ) : null}
      </header>

      {loading ? (
        <p className={styles.status}>{t('designLibrary.loading')}</p>
      ) : result && !result.ok ? (
        <div className={styles.empty} data-testid="design-library-empty">
          <p>{result.notFound ? t('designLibrary.emptyNotFound') : result.message}</p>
        </div>
      ) : catalog ? (
        <>
          <DesignLibraryPromotionPanel inboxPath={`${catalog.root}/_inbox`} />
          <div className={styles.toolbar}>
            <div className={styles.searchWrap}>
              <Icon name="search" size={15} className={styles.searchIcon} />
              <input
                className={styles.search}
                type="search"
                placeholder={t('designLibrary.searchPlaceholder')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              aria-label={t('designLibrary.allCategories')}
              className={styles.select}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">{t('designLibrary.allCategories')}</option>
              {categories.map((c) => (
                <option key={c.folder} value={c.folder}>
                  {c.title}
                </option>
              ))}
            </select>
            <select
              aria-label={t('designLibrary.allDomains')}
              className={`${styles.select} ${styles.domainSelect}`}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
            >
              <option value="">
                {t('designLibrary.allDomains')} ({collectionCount})
              </option>
              {domainCounts.map(([d, count]) => (
                <option key={d} value={d}>
                  {d} ({count})
                </option>
              ))}
            </select>
          </div>

          {!hasAnyItems ? (
            <div className={styles.empty}>
              <p>{t('designLibrary.emptyFiltered')}</p>
            </div>
          ) : (
            <>
              {primaryGroups.map((group) => (
                <DesignLibraryGroupSection
                  key={group.folder}
                  group={group}
                  t={t}
                  onOpenProject={onOpenProject}
                />
              ))}
              {humanLocalGroups.length > 0 ? (
                <section className={styles.humanLocalSection}>
                  <header className={styles.humanLocalHead}>
                    <h2 className={styles.humanLocalTitle}>Human Local Only</h2>
                    <p className={styles.groupBlurb}>Reference-only collections, kept separate from usable options.</p>
                  </header>
                  {humanLocalGroups.map((group) => (
                    <DesignLibraryGroupSection
                      key={group.folder}
                      group={group}
                      t={t}
                      onOpenProject={onOpenProject}
                      nested
                    />
                  ))}
                </section>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

function DesignLibraryGroupSection({
  group,
  t,
  onOpenProject,
  nested = false,
}: {
  group: RenderableGroup;
  t: ReturnType<typeof useT>;
  onOpenProject?: DesignLibraryOpenProjectHandler;
  nested?: boolean;
}) {
  const GroupHeading = nested ? 'h3' : 'h2';
  return (
    <section className={nested ? styles.nestedGroup : styles.group}>
      <header className={styles.groupHead}>
        <GroupHeading className={styles.groupTitle}>{group.title}</GroupHeading>
        <p className={styles.groupBlurb}>{group.blurb}</p>
        {group.hiddenDuplicateCount > 0 ? (
          <p className={styles.duplicatesHiddenNote}>
            {t('designLibrary.duplicatesHidden', { count: group.hiddenDuplicateCount })}
          </p>
        ) : null}
      </header>
      <div className={styles.grid} data-testid="design-library-grid">
        {group.items.map((item) => (
          <DesignLibraryCard key={item.id} item={item} t={t} onOpenProject={onOpenProject} />
        ))}
      </div>
    </section>
  );
}

// Shared start-project state for both source-copy and private-reference
// modes, used by the card and the preview dialog alike. Reference mode sends
// only the selected aspect names; the daemon resolves and bounds the local
// design context. Both surfaces must fail the same way.
function useStartFromDesignLibrary(
  item: DesignLibraryItem,
  t: ReturnType<typeof useT>,
  mode: 'copy' | 'reference',
  aspects: string[],
  onOpenProject?: DesignLibraryOpenProjectHandler,
) {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const canStart =
    Boolean(onOpenProject) &&
    (mode === 'copy'
      ? COPYABLE_ALLOWED_USE.has(item.allowed_use)
      : Boolean(item.reference) && REFERENCEABLE_ALLOWED_USE.has(item.allowed_use));

  // `brief` is only ever supplied for `mode: 'copy'` — the guided create
  // flow (PRD C8) sits in front of "Use as template" only; reference mode
  // keeps its existing aspect-selection flow untouched. An empty brief
  // (every guided question skipped) is dropped rather than sent, so the
  // request is byte-for-byte identical to today's single-click start.
  async function handleStart(brief?: GuidedCreateBrief) {
    if (starting) return;
    setStartError(null);
    setStarting(true);
    const hasBrief = Boolean(brief && Object.keys(brief).length > 0);
    try {
      const result =
        mode === 'reference'
          ? await startDesignLibraryProject(item.rel, undefined, { mode, aspects })
          : await startDesignLibraryProject(item.rel, undefined, hasBrief ? { mode: 'copy', brief } : undefined);
      if (!result.ok) {
        setStartError(
          result.message ||
            t(mode === 'copy' ? 'designLibrary.useAsTemplateError' : 'designLibrary.useAsReferenceError'),
        );
        return;
      }
      onOpenProject?.(
        result.response.projectId,
        result.response.conversationId,
        result.response.entryFile,
        result.response.project,
      );
    } catch {
      setStartError(
        t(mode === 'copy' ? 'designLibrary.useAsTemplateError' : 'designLibrary.useAsReferenceError'),
      );
    } finally {
      setStarting(false);
    }
  }

  return { starting, startError, canStart, handleStart };
}

// "Open live preview" — the collection's entry HTML in the OS browser, the
// full creation rather than the catalog's still thumbnail. Offered when the
// catalog found an entry_html AND the item is on a copyable tier: rendering
// runs the author's scripts, so third-party captures stay open-folder-only.
// Mirrors LIVE_PREVIEWABLE_ALLOWED_USE in the daemon route, which re-
// authorizes independently — this control is a hint, not the gate.
function useLivePreview(item: DesignLibraryItem, t: ReturnType<typeof useT>) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canOpen = canLivePreviewItem(item);

  async function handleOpen() {
    if (opening) return;
    setError(null);
    setOpening(true);
    const result = await openDesignLibraryLivePreview(item.rel);
    setOpening(false);
    if (!result.ok) setError(result.message || t('designLibrary.openLivePreviewError'));
  }

  return { opening, error, canOpen, handleOpen };
}

function OpenLivePreviewButton({
  opening,
  onClick,
  t,
}: {
  opening: boolean;
  onClick: () => void;
  t: ReturnType<typeof useT>;
}) {
  return (
    <button
      type="button"
      className={styles.openFolderBtn}
      onClick={onClick}
      disabled={opening}
      data-testid="design-library-live-preview"
    >
      <Icon name="external-link" size={14} />
      {opening ? t('designLibrary.openLivePreviewBusy') : t('designLibrary.openLivePreview')}
    </button>
  );
}

function UseAsTemplateButton({
  starting,
  onClick,
  t,
}: {
  starting: boolean;
  onClick: () => void;
  t: ReturnType<typeof useT>;
}) {
  return (
    <button type="button" className={styles.useAsTemplateBtn} onClick={onClick} disabled={starting}>
      <Icon name="sparkles" size={14} />
      {starting ? t('designLibrary.useAsTemplateBusy') : t('designLibrary.useAsTemplate')}
    </button>
  );
}

function UseAsReferenceButton({
  starting,
  selectedCount,
  onClick,
  t,
}: {
  starting: boolean;
  selectedCount: number;
  onClick: () => void;
  t: ReturnType<typeof useT>;
}) {
  return (
    <button type="button" className={styles.useAsTemplateBtn} onClick={onClick} disabled={starting}>
      <Icon name="sparkles" size={14} />
      {starting
        ? t('designLibrary.useAsReferenceBusy')
        : selectedCount > 0
          ? `${t('designLibrary.useAsReference')} · ${selectedCount} ${t('designLibrary.selectedAspects')}`
          : t('designLibrary.useAsReference')}
    </button>
  );
}

function AspectSelector({
  aspects,
  selected,
  onChange,
  t,
}: {
  aspects: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  t: ReturnType<typeof useT>;
}) {
  if (aspects.length === 0) return null;
  return (
    <div className={styles.aspectSection}>
      <span className={styles.aspectLabel}>{t('designLibrary.aspectsLabel')}</span>
      <div className={styles.aspectOptions}>
        <button
          type="button"
          className={styles.aspectChip}
          aria-pressed={selected.length === 0}
          onClick={() => onChange([])}
        >
          {t('designLibrary.fullDesign')}
        </button>
        {aspects.map((aspect) => {
          const isSelected = selected.includes(aspect);
          return (
            <button
              key={aspect}
              type="button"
              className={styles.aspectChip}
              aria-pressed={isSelected}
              onClick={() =>
                onChange(isSelected ? selected.filter((value) => value !== aspect) : [...selected, aspect])
              }
            >
              {aspect}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// MM-011 addition on top of the Templates pattern: a read-only orientation
// panel that surfaces over the title/description area on hover (or focus),
// with no click. Repeats the title and an expanded description (still
// individually clamped below — see the "hard truncation" note) and adds
// whatever the catalog already carries toward "what would this look like,
// what could this become" — suggested stack and carry-forward aspects. This
// is informational only: the actual carry-forward PICKER stays the existing
// AspectSelector / guided-create flow, never this panel. Domains are
// deliberately NOT here — see DesignLibraryCard's `.card` comment for why.
//
// Truncation: rather than one blind max-height + overflow: hidden cut on the
// panel as a whole (which can chop a section mid-sentence with no visual
// cue, and can't be scrolled to reveal the rest since the panel is
// `pointer-events: none`), each section clamps itself
// (DesignLibrarySection.module.css: hoverPanelDescription/hoverPanelSection)
// with `-webkit-line-clamp` — a native ellipsis, so every section stays at
// least summarily readable and the panel's total height is bounded by
// construction (sum of already-bounded sections) instead of an arbitrary
// box limit.
//
// Semantics: `role="group"` rather than the WAI-ARIA APG tooltip pattern —
// a tooltip is specified for short, plain supplementary text, and this panel
// carries a title plus a description plus two labeled data sections, which
// is too structured for that role. The trigger (DesignLibraryCard's
// titleArea) still associates via `aria-describedby` (screen readers read
// the panel's full text as the trigger's description regardless of the
// panel's own role). No `aria-expanded`: the trigger is a roleless text
// wrapper, and `aria-expanded` is only valid on roles that support it.
// The panel is never itself interactive or focusable (no tabIndex, no
// controls) and stays `pointer-events: none` so it can never intercept a
// click meant for the card underneath — hover/leave on the trigger is driven
// purely by the trigger's own (small, fixed) box, not by whatever the panel
// visually overlaps.
function DesignLibraryHoverPanel({
  item,
  t,
  id,
}: {
  item: DesignLibraryItem;
  t: ReturnType<typeof useT>;
  id: string;
}) {
  return (
    <div id={id} className={styles.hoverPanel} data-testid="design-library-hover-panel" role="group">
      <p className={styles.hoverPanelTitle}>{item.label}</p>
      {item.description ? <p className={styles.hoverPanelDescription}>{item.description}</p> : null}
      {item.stacks?.length ? (
        <p className={styles.hoverPanelSection}>
          <span className={styles.hoverPanelLabel}>{t('designLibrary.stacksLabel')}:</span>{' '}
          {item.stacks.join(' · ')}
        </p>
      ) : null}
      {item.aspects?.length ? (
        <p className={styles.hoverPanelSection}>
          <span className={styles.hoverPanelLabel}>{t('designLibrary.hoverCarryForwardLabel')}:</span>{' '}
          {item.aspects.join(' · ')}
        </p>
      ) : null}
    </div>
  );
}

function DesignLibraryCard({
  item,
  t,
  onOpenProject,
}: {
  item: DesignLibraryItem;
  t: ReturnType<typeof useT>;
  onOpenProject?: DesignLibraryOpenProjectHandler;
}) {
  const [thumbError, setThumbError] = useState(false);
  const [thumbLoaded, setThumbLoaded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);
  const [guidedOpen, setGuidedOpen] = useState(false);
  const [selectedAspects, setSelectedAspects] = useState<string[]>([]);
  const [hoverPanelOpen, setHoverPanelOpen] = useState(false);
  const { ref: thumbRef, inView: thumbInView } = useInView<HTMLDivElement>({
    once: true,
    rootMargin: '100px',
  });
  const hoverPanelId = `design-library-hover-panel-${item.id}`;
  const tooltip = t(ALLOWED_USE_TOOLTIP_KEY[item.allowed_use]);
  const templateStart = useStartFromDesignLibrary(
    item,
    t,
    'copy',
    [],
    onOpenProject,
  );
  const referenceStart = useStartFromDesignLibrary(item, t, 'reference', selectedAspects, onOpenProject);
  const livePreview = useLivePreview(item, t);
  const hasVisualPreview = Boolean(item.thumb) && !thumbError;

  // "Use as template" (PRD C8) opens the shared guided brief flow instead of
  // starting the project immediately — the dialog's own Skip/Start always
  // work, so the eventual startDesignLibraryProject call stays backward
  // compatible for a user who skips every question.
  function openGuidedCreate() {
    setPreviewOpen(false);
    setGuidedOpen(true);
  }

  return (
    <article className={styles.card} data-testid="design-library-card" data-allowed-use={item.allowed_use}>
      <div ref={thumbRef} className={styles.thumb} data-testid="design-library-cover">
        {hasVisualPreview && item.thumb ? (
          thumbInView ? (
            <img
              className={`${styles.thumbImg}${thumbLoaded ? ` ${styles.thumbImgLoaded}` : ''}`}
              src={designLibraryThumbUrl(item.thumb)}
              alt={item.label}
              loading="lazy"
              onLoad={() => setThumbLoaded(true)}
              onError={() => setThumbError(true)}
            />
          ) : null
        ) : (
          <div className={styles.thumbUnavailable} aria-hidden>
            <MediaFallback />
          </div>
        )}
        <button
          type="button"
          className={styles.thumbButton}
          aria-haspopup="dialog"
          aria-label={`${t('designLibrary.preview')} ${item.label}`}
          onClick={() => setPreviewOpen(true)}
        >
          <span className={styles.previewOverlay} aria-hidden>
            <Icon name="search" size={18} />
            <span>{t('designLibrary.preview')}</span>
          </span>
        </button>
        <span className={styles.badge} data-allowed-use={item.allowed_use} title={tooltip}>
          {allowedUseLabel(item.allowed_use)}
        </span>
      </div>
      <div className={styles.meta} data-testid="design-library-meta">
        <div
          className={styles.titleArea}
          data-testid="design-library-title-area"
          tabIndex={0}
          aria-describedby={hoverPanelOpen ? hoverPanelId : undefined}
          onMouseEnter={() => setHoverPanelOpen(true)}
          onMouseLeave={() => setHoverPanelOpen(false)}
          onFocus={() => setHoverPanelOpen(true)}
          onBlur={() => setHoverPanelOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && hoverPanelOpen) {
              e.stopPropagation();
              setHoverPanelOpen(false);
            }
          }}
        >
          <h3 className={styles.label}>{item.label}</h3>
          {item.description ? (
            <p className={styles.description} data-testid="design-library-description">
              {item.description}
            </p>
          ) : null}
          {hoverPanelOpen ? <DesignLibraryHoverPanel item={item} t={t} id={hoverPanelId} /> : null}
        </div>
        <p className={styles.detail}>
          {item.kind} · {item.files} {t(item.files === 1 ? 'designLibrary.filesUnitOne' : 'designLibrary.filesUnit')} · {item.size}
        </p>
        {referenceStart.canStart ? (
          <AspectSelector
            aspects={item.aspects ?? []}
            selected={selectedAspects}
            onChange={setSelectedAspects}
            t={t}
          />
        ) : null}
        {item.duplicate_of ? (
          <p className={styles.duplicateNote}>
            {t('designLibrary.duplicateOfPrefix')} {item.duplicate_of}
          </p>
        ) : null}
      </div>
      <div className={styles.cardActions} data-testid="design-library-actions">
        <div className={styles.cardActionsSecondary} data-testid="design-library-actions-secondary">
          <button type="button" className={styles.openFolderBtn} onClick={() => openDesignLibraryPath(item.rel)}>
            <Icon name="folder" size={14} />
            {t('designLibrary.openFolder')}
          </button>
          {livePreview.canOpen ? (
            <OpenLivePreviewButton opening={livePreview.opening} onClick={livePreview.handleOpen} t={t} />
          ) : null}
        </div>
        {templateStart.canStart ? (
          <div className={styles.cardActionsPrimary} data-testid="design-library-actions-primary">
            <UseAsTemplateButton
              starting={templateStart.starting}
              onClick={openGuidedCreate}
              t={t}
            />
          </div>
        ) : referenceStart.canStart ? (
          <div className={styles.cardActionsPrimary} data-testid="design-library-actions-primary">
            <UseAsReferenceButton
              starting={referenceStart.starting}
              selectedCount={selectedAspects.length}
              onClick={referenceStart.handleStart}
              t={t}
            />
          </div>
        ) : null}
      </div>
      {templateStart.startError || referenceStart.startError || livePreview.error ? (
        <p className={styles.startError}>
          {templateStart.startError || referenceStart.startError || livePreview.error}
        </p>
      ) : null}
      {guidedOpen ? (
        <GuidedCreateDialog
          title={item.label}
          subjectLabel={item.label}
          showMatchKitLook
          busy={templateStart.starting}
          onClose={() => setGuidedOpen(false)}
          onSubmit={(brief) => {
            setGuidedOpen(false);
            void templateStart.handleStart(brief);
          }}
        />
      ) : null}
      {previewOpen ? (
        <DesignLibraryDetailDialog
          item={item}
          t={t}
          onClose={() => setPreviewOpen(false)}
          onOpenProject={onOpenProject}
          selectedAspects={selectedAspects}
          onSelectedAspectsChange={setSelectedAspects}
          onExplore={
            canExploreKit(item)
              ? () => {
                  setPreviewOpen(false);
                  setCanvasOpen(true);
                }
              : undefined
          }
          onRequestGuidedCreate={templateStart.canStart ? openGuidedCreate : undefined}
        />
      ) : null}
      {canvasOpen ? (
        <DesignLibraryKitCanvas item={item} t={t} onClose={() => setCanvasOpen(false)} />
      ) : null}
    </article>
  );
}

// MM-012#1: the item's preview slides — the live entry page first (when the
// tier and catalog both allow it, via the same preview-asset serving path
// Explore Kit already uses), then every other gallery image the catalog
// published. A plain gallery image never leads; a static screenshot cannot
// be assessed the way the real, scrollable page can.
type DesignLibraryPreviewSlide = { kind: 'live' } | { kind: 'image'; src: string };

function previewSlides(item: DesignLibraryItem): DesignLibraryPreviewSlide[] {
  const images = galleryImages(item);
  if (!canLivePreviewItem(item)) return images.map((src) => ({ kind: 'image', src }));
  return [{ kind: 'live' }, ...images.map((src): DesignLibraryPreviewSlide => ({ kind: 'image', src }))];
}

// The detail view (t6/PRD C6): a preview pane that always fills its slot
// (the live page or a full-bleed image, never a letterboxed thumbnail),
// identity (title, canonical category chip, rights-tier badge, description),
// and the same permitted actions the card offers, in one consistent action
// bar. Rendered through the shared Dialog primitive in a portal so it
// escapes the grid; Escape closes via Dialog's own `closeOnEscape`.
function DesignLibraryDetailDialog({
  item,
  t,
  onClose,
  onOpenProject,
  onExplore,
  selectedAspects,
  onSelectedAspectsChange,
  onRequestGuidedCreate,
}: {
  item: DesignLibraryItem;
  t: ReturnType<typeof useT>;
  onClose: () => void;
  onOpenProject?: DesignLibraryOpenProjectHandler;
  onExplore?: () => void;
  selectedAspects: string[];
  onSelectedAspectsChange: (next: string[]) => void;
  /** Present only when "Use as template" is offered (PRD C8 guided flow). */
  onRequestGuidedCreate?: () => void;
}) {
  const slides = useMemo(() => previewSlides(item), [item]);
  const [activeIndex, setActiveIndex] = useState(0);
  const clampedIndex = slides.length > 0 ? activeIndex % slides.length : 0;
  const activeSlide = slides[clampedIndex] ?? null;
  const [heroError, setHeroError] = useState(false);
  const [heroLoaded, setHeroLoaded] = useState(false);
  const templateStart = useStartFromDesignLibrary(item, t, 'copy', [], onOpenProject);
  const referenceStart = useStartFromDesignLibrary(item, t, 'reference', selectedAspects, onOpenProject);
  const livePreview = useLivePreview(item, t);

  // A broken gallery image falls back to the shared unavailable state
  // instead of a broken-image glyph; reset per slide so a bad image at
  // index 1 doesn't poison index 2.
  useEffect(() => {
    setHeroError(false);
    setHeroLoaded(false);
  }, [clampedIndex]);

  function goNext() {
    setActiveIndex((i) => (i + 1) % slides.length);
  }
  function goPrev() {
    setActiveIndex((i) => (i - 1 + slides.length) % slides.length);
  }

  // Example cycling: left/right swaps the active example without reloading
  // the dialog. Escape stays owned entirely by the Dialog primitive above.
  useEffect(() => {
    if (slides.length <= 1) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft') goPrev();
      else if (event.key === 'ArrowRight') goNext();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  return createPortal(
    <Dialog
      ariaLabel={item.label}
      onClose={onClose}
      closeOnEscape
      backdropClassName={styles.previewBackdrop}
      className={styles.previewDialog}
    >
      <div className={styles.previewPane} data-testid="design-library-preview-pane">
        {!activeSlide ? (
          <div className={styles.previewUnavailable}>
            <MediaFallback size={32} />
          </div>
        ) : activeSlide.kind === 'live' ? (
          <iframe
            key="live"
            className={styles.previewFrame}
            src={designLibraryPreviewAssetUrl(item.rel, item.entry_html!)}
            title={item.label}
            sandbox="allow-scripts allow-popups"
            data-testid="design-library-preview-frame"
          />
        ) : heroError ? (
          <div className={styles.previewUnavailable}>
            <MediaFallback size={32} />
          </div>
        ) : (
          <div className={styles.previewImageScroll}>
            <img
              className={`${styles.previewImage}${heroLoaded ? ` ${styles.previewImageLoaded}` : ''}`}
              src={designLibraryThumbUrl(activeSlide.src)}
              alt={item.label}
              onLoad={() => setHeroLoaded(true)}
              onError={() => setHeroError(true)}
              data-testid="design-library-hero-image"
            />
          </div>
        )}
        {slides.length > 1 ? (
          <>
            <button
              type="button"
              className={`${styles.previewNav} ${styles.previewNavPrev}`}
              aria-label={t('designLibrary.previewPrev')}
              onClick={goPrev}
              data-testid="design-library-preview-prev"
            >
              <Icon name="chevron-left" size={18} />
            </button>
            <button
              type="button"
              className={`${styles.previewNav} ${styles.previewNavNext}`}
              aria-label={t('designLibrary.previewNext')}
              onClick={goNext}
              data-testid="design-library-preview-next"
            >
              <Icon name="chevron-right" size={18} />
            </button>
            <span className={styles.previewCounter}>
              {t('designLibrary.previewCounter', { current: clampedIndex + 1, total: slides.length })}
            </span>
          </>
        ) : null}
      </div>
      <div className={styles.previewMeta}>
        <div className={styles.previewHeading}>
          <h2 className={styles.previewTitle}>{item.label}</h2>
          <div className={styles.previewBadges}>
            <span className={styles.categoryChip}>{categoryLabel(item.category)}</span>
            <span
              className={`${styles.badge} ${styles.previewBadge}`}
              data-allowed-use={item.allowed_use}
              title={t(ALLOWED_USE_TOOLTIP_KEY[item.allowed_use])}
            >
              {allowedUseLabel(item.allowed_use)}
            </span>
          </div>
        </div>
        <p className={styles.detail}>
          {item.kind} · {item.files} {t(item.files === 1 ? 'designLibrary.filesUnitOne' : 'designLibrary.filesUnit')} · {item.size}
        </p>
        {item.description ? <p className={styles.previewDescription}>{item.description}</p> : null}
        {item.domains.length > 0 ? (
          <div className={styles.domains}>
            {item.domains.map((domain) => (
              <span key={domain} className={styles.domainTag}>
                {domain}
              </span>
            ))}
          </div>
        ) : null}
        {item.stacks?.length ? (
          <p className={styles.stackLine}>
            <span>{t('designLibrary.stacksLabel')}:</span> {item.stacks.join(' · ')}
          </p>
        ) : null}
        {item.duplicate_of ? (
          <p className={styles.duplicateNote}>
            {t('designLibrary.duplicateOfPrefix')} {item.duplicate_of}
          </p>
        ) : null}
        {referenceStart.canStart ? (
          <AspectSelector
            aspects={item.aspects ?? []}
            selected={selectedAspects}
            onChange={onSelectedAspectsChange}
            t={t}
          />
        ) : null}
        <div className={`${styles.cardActions} ${styles.previewActions}`}>
          <button type="button" className={styles.openFolderBtn} onClick={() => openDesignLibraryPath(item.rel)}>
            <Icon name="folder" size={14} />
            {t('designLibrary.openFolder')}
          </button>
          {livePreview.canOpen ? (
            <OpenLivePreviewButton opening={livePreview.opening} onClick={livePreview.handleOpen} t={t} />
          ) : null}
          {onExplore ? (
            <button type="button" className={styles.useAsTemplateBtn} onClick={onExplore} data-testid="design-library-explore-kit">
              <Icon name="layout" size={14} />
              {t('designLibrary.exploreKit')}
            </button>
          ) : null}
          {templateStart.canStart ? (
            <UseAsTemplateButton
              starting={templateStart.starting}
              onClick={() => onRequestGuidedCreate?.()}
              t={t}
            />
          ) : referenceStart.canStart ? (
            <UseAsReferenceButton
              starting={referenceStart.starting}
              selectedCount={selectedAspects.length}
              onClick={referenceStart.handleStart}
              t={t}
            />
          ) : null}
          <button type="button" className={styles.openFolderBtn} onClick={onClose}>
            {t('designLibrary.previewClose')}
          </button>
        </div>
        {templateStart.startError || referenceStart.startError || livePreview.error ? (
          <p className={styles.startError}>
            {templateStart.startError || referenceStart.startError || livePreview.error}
          </p>
        ) : null}
      </div>
    </Dialog>,
    document.body,
  );
}

// The interactive kit canvas (t7/PRD C7): the item's entry HTML in a
// scrollable, browser-viewport-sized iframe with a width toggle. Only
// reachable from `canExploreKit` items — see that guard for the category and
// rights gate. Sandboxed WITHOUT `allow-same-origin` so the previewed
// document — served same-origin for correct relative asset resolution, see
// the daemon's preview-asset route — gets an opaque origin regardless: a
// script inside it cannot reach this app's own `/api/*` as a same-origin
// caller.
const CANVAS_VIEWPORT_WIDTH = { desktop: 1280, mobile: 390 } as const;
type CanvasViewport = keyof typeof CANVAS_VIEWPORT_WIDTH;

function DesignLibraryKitCanvas({
  item,
  t,
  onClose,
}: {
  item: DesignLibraryItem;
  t: ReturnType<typeof useT>;
  onClose: () => void;
}) {
  const [viewport, setViewport] = useState<CanvasViewport>('desktop');
  if (!item.entry_html) return null;
  const src = designLibraryPreviewAssetUrl(item.rel, item.entry_html);
  return createPortal(
    <Dialog
      ariaLabel={`${item.label} — ${t('designLibrary.exploreKit')}`}
      onClose={onClose}
      closeOnEscape
      backdropClassName={styles.previewBackdrop}
      className={styles.canvasDialog}
    >
      <div className={styles.canvasHead}>
        <h2 className={styles.canvasTitle}>{item.label}</h2>
        <div className={styles.viewportToggle} role="group" aria-label={t('designLibrary.viewportLabel')}>
          <button
            type="button"
            aria-pressed={viewport === 'desktop'}
            onClick={() => setViewport('desktop')}
            data-testid="design-library-canvas-desktop"
          >
            <Icon name="layout" size={14} />
            {t('designLibrary.viewportDesktop')}
          </button>
          <button
            type="button"
            aria-pressed={viewport === 'mobile'}
            onClick={() => setViewport('mobile')}
            data-testid="design-library-canvas-mobile"
          >
            <Icon name="smartphone" size={14} />
            {t('designLibrary.viewportMobile')}
          </button>
        </div>
        <button type="button" className={styles.openFolderBtn} onClick={onClose}>
          {t('designLibrary.previewClose')}
        </button>
      </div>
      <div className={styles.canvasStage}>
        <iframe
          key={src}
          className={styles.canvasFrame}
          style={{ width: CANVAS_VIEWPORT_WIDTH[viewport] }}
          src={src}
          sandbox="allow-scripts allow-popups"
          title={item.label}
          data-testid="design-library-kit-canvas-frame"
        />
      </div>
    </Dialog>,
    document.body,
  );
}
