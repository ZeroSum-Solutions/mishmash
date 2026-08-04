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
import type { DesignLibraryAllowedUse, DesignLibraryItem } from '@open-design/contracts';
import {
  designLibraryThumbUrl,
  fetchDesignLibraryCatalog,
  openDesignLibraryPath,
  startDesignLibraryProject,
  type DesignLibraryCatalogResult,
} from '../providers/registry';
import { Icon } from './Icon';
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

  const filteredGroups = useMemo(() => {
    if (!catalog) return [];
    const query = search.trim().toLowerCase();
    return catalog.groups
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
  }, [catalog, search, category, domain]);

  const hasAnyItems = filteredGroups.length > 0;

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
          </div>

          <div className={styles.chips} role="group" aria-label={t('designLibrary.allDomains')}>
            <button
              type="button"
              className={styles.chip}
              data-active={domain === '' ? 'true' : 'false'}
              onClick={() => setDomain('')}
            >
              {t('designLibrary.allDomains')}
            </button>
            {domainCounts.map(([d, count]) => (
              <button
                key={d}
                type="button"
                className={styles.chip}
                data-active={domain === d ? 'true' : 'false'}
                onClick={() => setDomain((current) => (current === d ? '' : d))}
              >
                {d} <span className={styles.chipCount}>{count}</span>
              </button>
            ))}
          </div>

          {!hasAnyItems ? (
            <div className={styles.empty}>
              <p>{t('designLibrary.emptyFiltered')}</p>
            </div>
          ) : (
            filteredGroups.map((group) => (
              <section key={group.folder} className={styles.group}>
                <header className={styles.groupHead}>
                  <h2 className={styles.groupTitle}>{group.title}</h2>
                  <p className={styles.groupBlurb}>{group.blurb}</p>
                </header>
                <div className={styles.grid}>
                  {group.items.map((item) => (
                    <DesignLibraryCard key={item.id} item={item} t={t} onOpenProject={onOpenProject} />
                  ))}
                </div>
              </section>
            ))
          )}
        </>
      ) : null}
    </div>
  );
}

// Shared start-project state for both source-copy and private-reference
// modes. Reference mode sends only the selected aspect names; the daemon
// resolves and bounds the local design context.
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
  const hasPreview = Boolean(item.thumb) && !thumbError;

  return (
    <article className={styles.card} data-testid="design-library-card" data-allowed-use={item.allowed_use}>
      <div className={styles.thumb}>
        {item.thumb && !thumbError ? (
          <img
            className={styles.thumbImg}
            src={designLibraryThumbUrl(item.thumb)}
            alt={item.label}
            loading="lazy"
            onError={() => setThumbError(true)}
          />
        ) : (
          <Icon name="image" size={28} className={styles.thumbGlyph} />
        )}
        {hasPreview ? (
          <button
            type="button"
            className={styles.thumbButton}
            aria-haspopup="dialog"
            aria-label={`${t('designLibrary.preview')} ${item.label}`}
            onClick={() => setPreviewOpen(true)}
          >
            <span className={styles.previewOverlay} aria-hidden>
              <Icon name="search" size={20} />
            </span>
          </button>
        ) : null}
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
      {previewOpen && hasPreview ? (
        <DesignLibraryPreviewDialog
          item={item}
          t={t}
          onClose={() => setPreviewOpen(false)}
          onOpenProject={onOpenProject}
          selectedAspects={selectedAspects}
          onSelectedAspectsChange={setSelectedAspects}
        />
      ) : null}
    </article>
  );
}

// Full-size preview of a kit's composite screenshot — the founder's "open
// the full design system view" for catalog items whose richest available
// asset is the tiled screen composite. Rendered through the shared Dialog
// primitive in a portal so it escapes the card grid's overflow.
function DesignLibraryPreviewDialog({
  item,
  t,
  onClose,
  onOpenProject,
  selectedAspects,
  onSelectedAspectsChange,
}: {
  item: DesignLibraryItem;
  t: ReturnType<typeof useT>;
  onClose: () => void;
  onOpenProject?: (projectId: string, conversationId?: string) => void;
  selectedAspects: string[];
  onSelectedAspectsChange: (next: string[]) => void;
}) {
  const templateStart = useStartFromDesignLibrary(item, t, 'copy', [], onOpenProject);
  const referenceStart = useStartFromDesignLibrary(item, t, 'reference', selectedAspects, onOpenProject);
  if (!item.thumb) return null;
  return createPortal(
    <div className={styles.previewBackdrop} onClick={onClose}>
      <Dialog
        ariaLabel={item.label}
        onClose={onClose}
        closeOnEscape
        className={styles.previewDialog}
      >
        <div className={styles.previewImageWrap}>
          <img className={styles.previewImage} src={designLibraryThumbUrl(item.thumb)} alt={item.label} />
        </div>
        <div className={styles.previewMeta}>
          <h3 className={styles.label}>{item.label}</h3>
          <p className={styles.detail}>
            {item.kind} · {item.files} {t('designLibrary.filesUnit')} · {item.size}
          </p>
          {item.description ? <p className={styles.description}>{item.description}</p> : null}
          {item.stacks?.length ? (
            <p className={styles.stackLine}>
              <span>{t('designLibrary.stacksLabel')}:</span> {item.stacks.join(' · ')}
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
            <button type="button" className={styles.openFolderBtn} onClick={onClose}>
              {t('designLibrary.previewClose')}
            </button>
          </div>
          {templateStart.startError || referenceStart.startError ? (
            <p className={styles.startError}>{templateStart.startError || referenceStart.startError}</p>
          ) : null}
        </div>
      </Dialog>
    </div>,
    document.body,
  );
}
