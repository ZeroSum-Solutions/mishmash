import { Button } from './button';
import { joinClassNames } from './class-names';
import styles from './filter-active-summary.module.css';

export interface FilterActiveChip {
  id: string;
  label: string;
  onRemove: () => void;
}

export interface FilterActiveSummaryProps {
  chips: readonly FilterActiveChip[];
  clearAllLabel: string;
  onClearAll: () => void;
  ariaLabel: string;
  className?: string;
}

export function FilterActiveSummary({
  chips,
  clearAllLabel,
  onClearAll,
  ariaLabel,
  className,
}: FilterActiveSummaryProps) {
  if (chips.length === 0) return null;
  return (
    <div className={joinClassNames(styles.row, className)} role="group" aria-label={ariaLabel}>
      {chips.map((chip) => (
        <button key={chip.id} type="button" className={styles.chip} onClick={chip.onRemove}>
          <span>{chip.label}</span>
          <span className={styles.chipRemove} aria-hidden>
            ×
          </span>
        </button>
      ))}
      <Button type="button" variant="ghost" className={styles.clearAll} onClick={onClearAll}>
        {clearAllLabel}
      </Button>
    </div>
  );
}
