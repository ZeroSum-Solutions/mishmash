import { Button } from './button';
import { joinClassNames } from './class-names';
import styles from './filter-active-summary.module.css';

export interface FilterActiveChip {
  id: string;
  label: string;
  /**
   * Accessible name for the remove button. F007's a11y audit item: a chip
   * whose only visible text is the raw filter value (e.g. "Built-in")
   * announces just "Built-in" to a screen reader, not what the button does.
   * Callers should pass a distinguishing, already-localized string (e.g.
   * "Remove filter: Built-in") built from their own i18n dict — this
   * package ships no copy of its own, per AGENTS.md "i18n keys". Falls back
   * to `label` when omitted, matching the prior behavior.
   */
  removeLabel?: string;
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
        <button
          key={chip.id}
          type="button"
          className={styles.chip}
          aria-label={chip.removeLabel ?? chip.label}
          onClick={chip.onRemove}
        >
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
