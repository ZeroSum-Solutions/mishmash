// Assets left rail — permanent navigation, not a filter menu: search, "All
// Assets" with a live count, a Higgsfield-style "Types" section splitting
// assets by kind (each with its own count) plus a distinct "Generated" entry,
// and a Collections section. Collections have no backing data model in this
// repo yet (no schema change in this pass — see the module docblock in
// LibrarySection.tsx), so that section always renders its empty state; the
// "+" is a structural placeholder, not a working create action.
//
// Structure only, per the brief: colors/typography/tokens all come from this
// app's existing CSS custom properties, not the Higgsfield reference.

import { Icon } from '../Icon';
import { useT } from '../../i18n';
import { KindIcon, SOURCE_LABELS, kindLabel, kindTint, type BadgeKind } from '../LibraryAssetMeta';
import type { LibraryRailCounts } from './library-utils';
import styles from './LibraryRail.module.css';

/** Type buckets shown in the rail, in display order. Mirrors the kind filter
    the toolbar used to own (KIND_FILTERS in LibrarySection.tsx) minus the
    "All kinds" entry, which "All Assets" now covers. */
const RAIL_KINDS: BadgeKind[] = [
  'image',
  'element',
  'video',
  'html',
  'design-system',
  'font',
  'color',
  'text',
  'url',
];

export interface LibraryRailProps {
  search: string;
  onSearchChange: (value: string) => void;
  /** '' when no kind filter is active. */
  activeKind: string;
  /** Whether the "Generated" source filter is the active selection. */
  activeGenerated: boolean;
  onSelectAll: () => void;
  onSelectKind: (kind: BadgeKind) => void;
  onSelectGenerated: () => void;
  /** Grand total across the whole library, independent of the active filter. */
  grandTotal: number;
  counts: LibraryRailCounts;
}

export function LibraryRail({
  search,
  onSearchChange,
  activeKind,
  activeGenerated,
  onSelectAll,
  onSelectKind,
  onSelectGenerated,
  grandTotal,
  counts,
}: LibraryRailProps) {
  const t = useT();
  const allActive = !activeKind && !activeGenerated;

  return (
    <nav className={styles.rail} aria-label={t('library.rail.allAssets')}>
      <div className={styles.searchWrap}>
        <Icon name="search" size={15} className={styles.searchIcon} />
        <input
          className={styles.search}
          type="search"
          placeholder={t('library.rail.searchPlaceholder')}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <button
        type="button"
        className={styles.allAssets}
        data-active={allActive ? 'true' : 'false'}
        aria-label={`${t('library.rail.allAssets')} (${grandTotal})`}
        onClick={onSelectAll}
      >
        <span aria-hidden>{t('library.rail.allAssets')}</span>
        <span className={styles.count} aria-hidden>
          {grandTotal}
        </span>
      </button>

      <div className={styles.section}>
        <h3 className={styles.sectionLabel}>{t('library.rail.types')}</h3>
        <ul className={styles.list}>
          {RAIL_KINDS.map((kind) => {
            const count = counts.byKind[kind] ?? 0;
            return (
              <li key={kind}>
                <button
                  type="button"
                  className={styles.item}
                  data-active={!activeGenerated && activeKind === kind ? 'true' : 'false'}
                  aria-label={`${kindLabel(kind)} (${count})`}
                  onClick={() => onSelectKind(kind)}
                >
                  <span className={styles.itemIcon} style={{ ['--kind-tint' as string]: kindTint(kind) }} aria-hidden>
                    <KindIcon kind={kind} size={14} />
                  </span>
                  <span className={styles.itemLabel} aria-hidden>
                    {kindLabel(kind)}
                  </span>
                  <span className={styles.count} aria-hidden>
                    {count}
                  </span>
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              className={styles.item}
              data-active={activeGenerated ? 'true' : 'false'}
              aria-label={`${SOURCE_LABELS.generated} (${counts.generated})`}
              onClick={onSelectGenerated}
            >
              <span className={styles.itemIcon} style={{ ['--kind-tint' as string]: 'var(--purple)' }} aria-hidden>
                <Icon name="sparkles" size={14} />
              </span>
              <span className={styles.itemLabel} aria-hidden>
                {SOURCE_LABELS.generated}
              </span>
              <span className={styles.count} aria-hidden>
                {counts.generated}
              </span>
            </button>
          </li>
        </ul>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <h3 className={styles.sectionLabel}>{t('library.rail.collections')}</h3>
          <button
            type="button"
            className={`${styles.newCollectionBtn} od-tooltip`}
            aria-label={t('library.rail.newCollection')}
            disabled
            data-tooltip={t('library.rail.collectionsUnavailable')}
            data-tooltip-placement="right"
          >
            <Icon name="plus" size={13} />
          </button>
        </div>
        <p className={styles.collectionsEmpty}>{t('library.rail.collectionsEmpty')}</p>
      </div>
    </nav>
  );
}
