// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FilterSearchInput } from '../src/filter-search-input';

afterEach(() => {
  cleanup();
});

describe('FilterSearchInput', () => {
  it('labels the input accessibly and reports typed input', () => {
    const onChange = vi.fn();
    render(<FilterSearchInput label="Search templates" value="" onChange={onChange} />);

    const input = screen.getByRole('searchbox', { name: 'Search templates' });
    fireEvent.change(input, { target: { value: 'hero' } });

    expect(onChange).toHaveBeenCalledWith('hero');
  });

  it('shows no clear button when the value is empty', () => {
    render(<FilterSearchInput label="Search templates" value="" onChange={() => {}} />);

    expect(screen.queryByRole('button')).toBeNull();
  });

  it('clear button empties the value and returns focus to the input', () => {
    const onChange = vi.fn();
    render(<FilterSearchInput label="Search templates" value="hero" onChange={onChange} clearLabel="Clear search" />);

    const clearButton = screen.getByRole('button', { name: 'Clear search' });
    fireEvent.click(clearButton);

    expect(onChange).toHaveBeenCalledWith('');
    expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search templates' }));
  });

  it('falls back to the field label for the clear button name when clearLabel is omitted', () => {
    render(<FilterSearchInput label="Search templates" value="hero" onChange={() => {}} />);

    expect(screen.getByRole('button', { name: 'Search templates' })).toBeTruthy();
  });
});
