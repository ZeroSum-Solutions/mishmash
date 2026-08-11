// The Assets main-area grid: a flat grid (legacy view, preserved) and the
// default date-grouped grid (Today / Yesterday / a date…), each day carrying
// a bulk-select checkbox. Box-select (rubber-band drag) and click/shift/cmd
// selection stay owned by LibrarySection — this component is presentational,
// wired through `gridRef` + `onMouseDown` + `renderCard`.

import type { ReactNode, RefObject } from 'react';
import type { LibraryAsset } from '@open-design/contracts';
import { dayHeading, groupByDay } from './library-utils';
import styles from './LibraryGrid.module.css';

export interface LibraryGridProps {
  viewMode: 'grid' | 'timeline';
  assets: LibraryAsset[];
  gridRef: RefObject<HTMLDivElement>;
  onMouseDown: (e: React.MouseEvent) => void;
  selecting: boolean;
  selectedIds: Set<string>;
  onToggleGroup: (ids: string[]) => void;
  renderCard: (asset: LibraryAsset, index: number) => ReactNode;
}

export function LibraryGrid({
  viewMode,
  assets,
  gridRef,
  onMouseDown,
  selecting,
  selectedIds,
  onToggleGroup,
  renderCard,
}: LibraryGridProps) {
  if (viewMode === 'grid') {
    return (
      <div
        className={styles.grid}
        ref={gridRef}
        onMouseDown={onMouseDown}
        data-selecting={selecting ? 'true' : 'false'}
      >
        {assets.map((asset, index) => renderCard(asset, index))}
      </div>
    );
  }

  const groups = groupByDay(assets);
  return (
    <div ref={gridRef} onMouseDown={onMouseDown} data-selecting={selecting ? 'true' : 'false'}>
      {groups.map((group) => {
        const ids = group.items.map((item) => item.asset.id);
        const selectedCount = ids.filter((id) => selectedIds.has(id)).length;
        const state = selectedCount === 0 ? 'unchecked' : selectedCount === ids.length ? 'checked' : 'indeterminate';
        return (
          <section key={group.key} className={styles.dayGroup}>
            <div className={styles.dayHead}>
              <button
                type="button"
                className={styles.dayCheck}
                data-state={state}
                aria-label={
                  state === 'checked' ? `Deselect ${group.items.length} from this day` : `Select ${group.items.length} from this day`
                }
                onClick={() => onToggleGroup(ids)}
              >
                {state !== 'unchecked' ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    {state === 'checked' ? <path d="M20 6 9 17l-5-5" /> : <path d="M5 12h14" />}
                  </svg>
                ) : null}
              </button>
              <h2 className={styles.dayDate}>{dayHeading(group.key)}</h2>
              <span className={styles.dayCount}>{group.items.length}</span>
            </div>
            <div className={styles.dayGrid}>
              {group.items.map(({ asset, index }) => renderCard(asset, index))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
