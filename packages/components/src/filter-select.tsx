import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { joinClassNames } from './class-names';
import { Select } from './form-controls';
import styles from './filter-select.module.css';

export interface FilterSelectOption {
  value: string;
  label: string;
  count?: number;
}

function optionText(option: FilterSelectOption): string {
  return option.count === undefined ? option.label : `${option.label} (${option.count})`;
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

// Single-select facet. A native <select> already gives every R5 keyboard
// behaviour (arrow keys, Home/End, Escape, focus-visible) for free from the
// browser, so this stays a thin styling wrapper rather than a custom widget.
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
            {optionText(option)}
          </option>
        ))}
      </Select>
    </label>
  );
}

export interface FilterMultiSelectProps {
  label: string;
  /** Currently-selected option values. */
  values: readonly string[];
  options: readonly FilterSelectOption[];
  onChange: (values: string[]) => void;
  /** Trigger text when nothing is selected, e.g. "All". */
  allLabel: string;
  className?: string;
  testId?: string;
}

// Multi-select facet ("heroes OR footers"). There is no native multi-select
// dropdown control that matches R3 (a closed single-line trigger that opens
// a popup, rather than an always-open multi-row listbox), so this is a small
// custom listbox popup: role="listbox" + aria-multiselectable, an
// aria-activedescendant-highlighted option list, and the R5 keyboard
// contract (ArrowUp/ArrowDown/Home/End move the highlight, Enter/Space
// toggles it, Escape and Tab close the popup and restore focus to the
// trigger button that opened it).
export function FilterMultiSelect({
  label,
  values,
  options,
  onChange,
  allLabel,
  className,
  testId,
}: FilterMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const selected = new Set(values);
  const isActive = values.length > 0;
  const lastIndex = Math.max(0, options.length - 1);

  const summary =
    values.length === 0
      ? allLabel
      : values.length === 1
        ? (options.find((option) => option.value === values[0])?.label ?? allLabel)
        : `${label} (${values.length})`;

  // Close on outside interaction — the popup is not modal, so anything
  // outside the trigger+listbox pair should dismiss it like any dropdown.
  useEffect(() => {
    if (!open) return undefined;
    function onDocumentMouseDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => document.removeEventListener('mousedown', onDocumentMouseDown);
  }, [open]);

  // Move DOM focus onto the listbox itself when it opens, so
  // aria-activedescendant highlighting is announced by assistive tech, and
  // start the highlight on the first already-selected option (or the first
  // option) rather than always resetting to the top.
  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const firstSelected = options.findIndex((option) => selected.has(option.value));
    setActiveIndex(firstSelected >= 0 ? firstSelected : 0);
    // Deliberately keyed on `open` only: re-deriving the initial highlight
    // on every keystroke/selection would fight the user's own
    // ArrowUp/ArrowDown movement.
  }, [open]);

  function closeAndRestoreFocus() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function toggleOption(index: number) {
    const option = options[index];
    if (!option) return;
    const next = selected.has(option.value)
      ? values.filter((value) => value !== option.value)
      : [...values, option.value];
    onChange(next);
  }

  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
    }
  }

  function onListKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, lastIndex));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(lastIndex);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        toggleOption(activeIndex);
        break;
      case 'Escape':
        event.preventDefault();
        closeAndRestoreFocus();
        break;
      case 'Tab':
        // Let focus continue to whatever is next in tab order; just don't
        // leave the popup open behind it.
        setOpen(false);
        break;
      default:
        break;
    }
  }

  const activeOption = options[activeIndex];
  const activeOptionId = activeOption ? `${baseId}-option-${activeIndex}` : undefined;
  const labelId = `${baseId}-label`;
  const listId = `${baseId}-listbox`;

  return (
    <div className={joinClassNames(styles.multiField, className)} ref={rootRef}>
      <span className={styles.fieldLabel} id={labelId}>
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        className={styles.multiTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        // A plain `aria-label` (matching FilterSelect's own `aria-label={label}`)
        // rather than `aria-labelledby` pointing at both the outer label span
        // and this summary — that would narrate the facet name twice
        // ("Section Section (2)") once the summary itself starts with it.
        aria-label={`${label}: ${summary}`}
        data-active={isActive ? 'true' : undefined}
        data-testid={testId}
        onClick={() => (open ? closeAndRestoreFocus() : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
      >
        <span aria-hidden="true">{summary}</span>
      </button>
      {open ? (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby={labelId}
          aria-activedescendant={activeOptionId}
          tabIndex={-1}
          className={styles.multiPopup}
          data-testid={testId ? `${testId}-listbox` : undefined}
          onKeyDown={onListKeyDown}
        >
          {options.map((option, index) => {
            const isSelected = selected.has(option.value);
            return (
              <li
                key={option.value}
                id={`${baseId}-option-${index}`}
                role="option"
                aria-selected={isSelected}
                className={joinClassNames(
                  styles.multiOption,
                  index === activeIndex && styles.multiOptionActive,
                )}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => toggleOption(index)}
              >
                <span className={styles.multiOptionCheck} aria-hidden="true">
                  {isSelected ? '✓' : ''}
                </span>
                <span>{optionText(option)}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
