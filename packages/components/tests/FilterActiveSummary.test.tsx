// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FilterActiveSummary } from '../src/filter-active-summary';

afterEach(() => {
  cleanup();
});

describe('FilterActiveSummary', () => {
  it('renders nothing when there are no active filters', () => {
    const { container } = render(
      <FilterActiveSummary chips={[]} clearAllLabel="Clear filters" onClearAll={() => {}} ariaLabel="Active filters" />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('falls back to the visible label for the remove button name when removeLabel is omitted', () => {
    render(
      <FilterActiveSummary
        chips={[{ id: 'source', label: 'Built-in', onRemove: () => {} }]}
        clearAllLabel="Clear filters"
        onClearAll={() => {}}
        ariaLabel="Active filters"
      />,
    );

    expect(screen.getByRole('button', { name: 'Built-in' })).toBeTruthy();
  });

  it('uses removeLabel as the accessible name when the caller supplies one (F007 item 6)', () => {
    render(
      <FilterActiveSummary
        chips={[
          {
            id: 'source',
            label: 'Built-in',
            removeLabel: 'Remove filter: Built-in',
            onRemove: () => {},
          },
        ]}
        clearAllLabel="Clear filters"
        onClearAll={() => {}}
        ariaLabel="Active filters"
      />,
    );

    expect(screen.getByRole('button', { name: 'Remove filter: Built-in' })).toBeTruthy();
    // The visible text is still the bare label, not the longer aria-label.
    expect(screen.getByRole('button', { name: 'Remove filter: Built-in' }).textContent).toContain('Built-in');
  });

  it('calls each chip onRemove independently', () => {
    const onRemoveA = vi.fn();
    const onRemoveB = vi.fn();
    render(
      <FilterActiveSummary
        chips={[
          { id: 'a', label: 'Hero', onRemove: onRemoveA },
          { id: 'b', label: 'Footer', onRemove: onRemoveB },
        ]}
        clearAllLabel="Clear filters"
        onClearAll={() => {}}
        ariaLabel="Active filters"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Hero' }));

    expect(onRemoveA).toHaveBeenCalledTimes(1);
    expect(onRemoveB).not.toHaveBeenCalled();
  });

  it('calls onClearAll from the clear-all control', () => {
    const onClearAll = vi.fn();
    render(
      <FilterActiveSummary
        chips={[{ id: 'a', label: 'Hero', onRemove: () => {} }]}
        clearAllLabel="Clear filters"
        onClearAll={onClearAll}
        ariaLabel="Active filters"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(onClearAll).toHaveBeenCalledTimes(1);
  });
});
