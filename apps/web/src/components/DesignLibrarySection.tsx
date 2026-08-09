// Design Library tab — browse of the local curated reference-asset library
// (apps/daemon/src/routes/design-library.ts serves it from
// ~/Desktop/Design Assets, or OD_DESIGN_LIBRARY_DIR). Every collection is
// rights-gated via `allowed_use`; "Open folder" in Finder is always offered,
// and "Use as template" (copies the kit's files into a new project) is
// offered ONLY for the two copyable tiers, own-code and
// licensed-source-review — every other tier stays browse/open-only, so a
// restricted item can never leak into a project this way.
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
} from '@open-design/contracts';
import {
  designLibraryThumbUrl,
  fetchDesignLibraryCatalog,
  openDesignLibraryPath,
  startDesignLibraryProject,
  type DesignLibraryCatalogResult,
} from '../providers/registry';
import { Icon } from './Icon';
import { DesignLibraryPromotionPanel } from './DesignLibraryPromotionPanel';
import { useT } from '../i18n';
import styles from './DesignLibrarySection.module.css';

interface Props {
  active: boolean;
  /** Omit to hide "Use as template" entirely (e.g. no project-navigation host). */
  onOpenProject?: (projectId: string, conversationId?: string) => void;
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
    const primaryGroups: DesignLibraryGroup[] = [];
    const humanLocalGroups: DesignLibraryGroup[] = [];
    for (const group of matchingGroups) {
      const primaryItems = group.items.filter((item) => item.allowed_use !== 'human-local-only');
      const humanLocalItems = group.items.filter((item) => item.allowed_use === 'human-local-only');
      if (primaryItems.length > 0) primaryGroups.push({ ...group, items: primaryItems });
      if (humanLocalItems.length > 0) humanLocalGroups.push({ ...group, items: humanLocalItems });
    }
    return { primaryGroups, humanLocalGroups };
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
  group: DesignLibraryGroup;
  t: ReturnType<typeof useT>;
  onOpenProject?: (projectId: string, conversationId?: string) => void;
  nested?: boolean;
}) {
  const GroupHeading = nested ? 'h3' : 'h2';
  return (
    <section className={nested ? styles.nestedGroup : styles.group}>
      <header className={styles.groupHead}>
        <GroupHeading className={styles.groupTitle}>{group.title}</GroupHeading>
        <p className={styles.groupBlurb}>{group.blurb}</p>
      </header>
      <div className={styles.grid}>
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
  onOpenProject?: (projectId: string, conversationId?: string) => void,
) {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const canStart =
    Boolean(onOpenProject) &&
    (mode === 'copy'
      ? COPYABLE_ALLOWED_USE.has(item.allowed_use)
      : Boolean(item.reference) && REFERENCEABLE_ALLOWED_USE.has(item.allowed_use));

  async function handleStart() {
    if (starting) return;
    setStartError(null);
    setStarting(true);
    const result =
      mode === 'reference'
        ? await startDesignLibraryProject(item.rel, undefined, { mode, aspects })
        : await startDesignLibraryProject(item.rel);
    setStarting(false);
    if (!result.ok) {
      setStartError(
        result.message ||
          t(mode === 'copy' ? 'designLibrary.useAsTemplateError' : 'designLibrary.useAsReferenceError'),
      );
      return;
    }
    onOpenProject?.(result.response.projectId, result.response.conversationId);
  }

  return { starting, startError, canStart, handleStart };
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

function DesignLibraryCard({
  item,
  t,
  onOpenProject,
}: {
  item: DesignLibraryItem;
  t: ReturnType<typeof useT>;
  onOpenProject?: (projectId: string, conversationId?: string) => void;
}) {
  const [thumbError, setThumbError] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedAspects, setSelectedAspects] = useState<string[]>([]);
  const tooltip = t(ALLOWED_USE_TOOLTIP_KEY[item.allowed_use]);
  const templateStart = useStartFromDesignLibrary(
    item,
    t,
    'copy',
    [],
    onOpenProject,
  );
  const referenceStart = useStartFromDesignLibrary(item, t, 'reference', selectedAspects, onOpenProject);
  const hasVisualPreview = Boolean(item.thumb) && !thumbError;

  return (
    <article className={styles.card} data-testid="design-library-card" data-allowed-use={item.allowed_use}>
      <div className={styles.thumb}>
        {hasVisualPreview && item.thumb ? (
          <img
            className={styles.thumbImg}
            src={designLibraryThumbUrl(item.thumb)}
            alt={item.label}
            loading="lazy"
            onError={() => setThumbError(true)}
          />
        ) : (
          <div className={styles.thumbUnavailable} aria-hidden>
            <Icon name="image" size={28} className={styles.thumbGlyph} />
            <span>Visual preview unavailable</span>
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
      <div className={styles.meta}>
        <h3 className={styles.label}>{item.label}</h3>
        <p className={styles.detail}>
          {item.kind} · {item.files} {t('designLibrary.filesUnit')} · {item.size}
        </p>
        {item.description ? (
          <p className={styles.description} data-testid="design-library-description">
            {item.description}
          </p>
        ) : null}
        {item.domains.length > 0 ? (
          <div className={styles.domains}>
            {item.domains.map((d) => (
              <span key={d} className={styles.domainTag}>
                {d}
              </span>
            ))}
          </div>
        ) : null}
        {item.stacks?.length ? (
          <p className={styles.stackLine}>
            <span>{t('designLibrary.stacksLabel')}:</span> {item.stacks.join(' · ')}
          </p>
        ) : null}
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
      <div className={styles.cardActions}>
        <button type="button" className={styles.openFolderBtn} onClick={() => openDesignLibraryPath(item.rel)}>
          <Icon name="folder" size={14} />
          {t('designLibrary.openFolder')}
        </button>
        {templateStart.canStart ? (
          <UseAsTemplateButton
            starting={templateStart.starting}
            onClick={templateStart.handleStart}
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
      </div>
      {templateStart.startError || referenceStart.startError ? (
        <p className={styles.startError}>{templateStart.startError || referenceStart.startError}</p>
      ) : null}
      {previewOpen ? (
        <DesignLibraryPreviewDialog
          item={item}
          t={t}
          hasVisualPreview={hasVisualPreview}
          onClose={() => setPreviewOpen(false)}
          onOpenProject={onOpenProject}
          selectedAspects={selectedAspects}
          onSelectedAspectsChange={setSelectedAspects}
        />
      ) : null}
    </article>
  );
}

// Quick catalog details for every item. When the catalog supplies a curated
// visual it is shown uncropped; otherwise the dialog keeps the metadata and
// permitted actions useful without inventing a preview asset. Rendered
// through the shared Dialog primitive in a portal so it escapes the grid.
function DesignLibraryPreviewDialog({
  item,
  t,
  hasVisualPreview,
  onClose,
  onOpenProject,
  selectedAspects,
  onSelectedAspectsChange,
}: {
  item: DesignLibraryItem;
  t: ReturnType<typeof useT>;
  hasVisualPreview: boolean;
  onClose: () => void;
  onOpenProject?: (projectId: string, conversationId?: string) => void;
  selectedAspects: string[];
  onSelectedAspectsChange: (next: string[]) => void;
}) {
  const [previewImageError, setPreviewImageError] = useState(false);
  const templateStart = useStartFromDesignLibrary(item, t, 'copy', [], onOpenProject);
  const referenceStart = useStartFromDesignLibrary(item, t, 'reference', selectedAspects, onOpenProject);
  const showImage = hasVisualPreview && Boolean(item.thumb) && !previewImageError;
  return createPortal(
    <Dialog
      ariaLabel={item.label}
      onClose={onClose}
      closeOnEscape
      backdropClassName={styles.previewBackdrop}
      className={styles.previewDialog}
    >
      <div className={styles.previewImageWrap}>
        {showImage && item.thumb ? (
          <img
            className={styles.previewImage}
            src={designLibraryThumbUrl(item.thumb)}
            alt={item.label}
            onError={() => setPreviewImageError(true)}
          />
        ) : (
          <div className={styles.previewUnavailable}>
            <Icon name="image" size={32} className={styles.thumbGlyph} />
            <span>Visual preview unavailable</span>
          </div>
        )}
      </div>
      <div className={styles.previewMeta}>
        <div className={styles.previewHeading}>
          <h2 className={styles.previewTitle}>{item.label}</h2>
          <span
            className={`${styles.badge} ${styles.previewBadge}`}
            data-allowed-use={item.allowed_use}
            title={t(ALLOWED_USE_TOOLTIP_KEY[item.allowed_use])}
          >
            {allowedUseLabel(item.allowed_use)}
          </span>
        </div>
        <p className={styles.detail}>
          {item.kind} · {item.files} {t('designLibrary.filesUnit')} · {item.size}
        </p>
        {item.description ? <p className={styles.description}>{item.description}</p> : null}
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
          {templateStart.canStart ? (
            <UseAsTemplateButton
              starting={templateStart.starting}
              onClick={templateStart.handleStart}
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
        {templateStart.startError || referenceStart.startError ? (
          <p className={styles.startError}>{templateStart.startError || referenceStart.startError}</p>
        ) : null}
      </div>
    </Dialog>,
    document.body,
  );
}
