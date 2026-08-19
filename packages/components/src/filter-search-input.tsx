import { useRef } from 'react';

import { joinClassNames } from './class-names';
import { Input } from './form-controls';
import styles from './filter-search-input.module.css';

export interface FilterSearchInputProps {
  /** Accessible name — not rendered as visible text, matching FilterSelect. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name for the clear button; falls back to `label`. */
  clearLabel?: string;
  className?: string;
  testId?: string;
}

// Free-text search, the fourth element of the "search + Category ▾ +
// Section ▾ + Source ▾" filter bar the finding proposes. Deliberately plain
// text, not a combobox — it narrows the underlying list, it does not filter
// the options inside another control.
export function FilterSearchInput({
  label,
  value,
  onChange,
  placeholder,
  clearLabel,
  className,
  testId,
}: FilterSearchInputProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className={joinClassNames(styles.field, className)}>
      <Input
        ref={inputRef}
        type="search"
        aria-label={label}
        className={styles.input}
        value={value}
        placeholder={placeholder}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button
          type="button"
          className={styles.clear}
          aria-label={clearLabel ?? label}
          data-testid={testId ? `${testId}-clear` : undefined}
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </div>
  );
}
