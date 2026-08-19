// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FilterSelect } from '../src/filter-select';

afterEach(() => {
  cleanup();
});

describe('FilterSelect', () => {
  it('labels the control and renders counts alongside each option', () => {
    render(
      <FilterSelect
        label="Category"
        value="all"
        defaultValue="all"
        options={[
          { value: 'all', label: 'All' },
          { value: 'hero', label: 'Hero', count: 52 },
        ]}
        onChange={() => {}}
      />,
    );

    const select = screen.getByRole('combobox', { name: 'Category' });
    expect(select).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Hero (52)' })).toBeTruthy();
  });

  it('reports active state via data-active only once the value differs from the default', () => {
    const { rerender } = render(
      <FilterSelect
        label="Source"
        value="all"
        defaultValue="all"
        options={[{ value: 'all', label: 'All' }]}
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole('combobox').getAttribute('data-active')).toBeNull();

    rerender(
      <FilterSelect
        label="Source"
        value="user"
        defaultValue="all"
        options={[
          { value: 'all', label: 'All' },
          { value: 'user', label: 'Yours' },
        ]}
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole('combobox').getAttribute('data-active')).toBe('true');
  });

  it('calls onChange with the newly picked value', () => {
    const onChange = vi.fn();
    render(
      <FilterSelect
        label="Source"
        value="all"
        options={[
          { value: 'all', label: 'All' },
          { value: 'user', label: 'Yours' },
        ]}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'user' } });

    expect(onChange).toHaveBeenCalledWith('user');
  });
});
