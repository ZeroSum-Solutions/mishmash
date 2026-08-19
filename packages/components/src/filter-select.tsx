import { joinClassNames } from './class-names';
import { Select } from './form-controls';
import styles from './filter-select.module.css';

export interface FilterSelectOption {
  value: string;
  label: string;
  count?: number;
}

export interface FilterSelectProps {
  label: string;
  value: string;
  options: readonly FilterSelectOption[];
  onChange: (value: string) => void;
  defaultValue?: string;
  className?: string;
  testId?: string;
}

export function FilterSelect({
  label,
  value,
  options,
  onChange,
  defaultValue,
  className,
  testId,
}: FilterSelectProps) {
  const isActive = defaultValue !== undefined && value !== defaultValue;
  return (
    <label className={joinClassNames(styles.field, className)}>
      <span className={styles.fieldLabel}>{label}</span>
      <Select
        aria-label={label}
        className={styles.select}
        value={value}
        data-active={isActive ? 'true' : undefined}
        data-testid={testId}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.count === undefined ? option.label : `${option.label} (${option.count})`}
          </option>
        ))}
      </Select>
    </label>
  );
}
