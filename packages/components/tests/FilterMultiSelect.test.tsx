// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FilterMultiSelect } from '../src/filter-select';

afterEach(() => {
  cleanup();
});

const OPTIONS = [
  { value: 'hero', label: 'Hero', count: 52 },
  { value: 'footer', label: 'Footer', count: 2 },
  { value: 'faq', label: 'FAQ', count: 1 },
];

describe('FilterMultiSelect', () => {
  it('shows the "all" label when nothing is selected, and opens on click', () => {
    render(
      <FilterMultiSelect label="Section" values={[]} options={OPTIONS} allLabel="All" onChange={() => {}} />,
    );

    const trigger = screen.getByRole('button', { name: /Section/ });
    expect(trigger.textContent).toBe('All');
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(trigger);

    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('summarizes the trigger by count once more than one value is selected', () => {
    render(
      <FilterMultiSelect
        label="Section"
        values={['hero', 'footer']}
        options={OPTIONS}
        allLabel="All"
        onChange={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: /Section/ }).textContent).toBe('Section (2)');
  });

  it('toggles an option on Enter and reports the updated selection — "heroes OR footers"', () => {
    const onChange = vi.fn();
    render(
      <FilterMultiSelect label="Section" values={['hero']} options={OPTIONS} allLabel="All" onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Section/ }));
    const listbox = screen.getByRole('listbox');

    // Highlight starts on the first already-selected option (hero, index 0);
    // move to footer and toggle it on.
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(['hero', 'footer']);
  });

  it('toggles a selected option off by clicking it', () => {
    const onChange = vi.fn();
    render(
      <FilterMultiSelect
        label="Section"
        values={['hero', 'footer']}
        options={OPTIONS}
        allLabel="All"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Section/ }));
    fireEvent.click(screen.getByRole('option', { name: /Footer/ }));

    expect(onChange).toHaveBeenCalledWith(['hero']);
  });

  it('Home and End jump the highlight to the first and last option', () => {
    render(
      <FilterMultiSelect label="Section" values={[]} options={OPTIONS} allLabel="All" onChange={() => {}} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Section/ }));
    const listbox = screen.getByRole('listbox');

    fireEvent.keyDown(listbox, { key: 'End' });
    expect(listbox.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: /FAQ/ }).id,
    );

    fireEvent.keyDown(listbox, { key: 'Home' });
    expect(listbox.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: /Hero/ }).id,
    );
  });

  it('closes and restores focus to the trigger on Escape', () => {
    render(
      <FilterMultiSelect label="Section" values={[]} options={OPTIONS} allLabel="All" onChange={() => {}} />,
    );

    const trigger = screen.getByRole('button', { name: /Section/ });
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on Tab without trapping focus', () => {
    render(
      <FilterMultiSelect label="Section" values={[]} options={OPTIONS} allLabel="All" onChange={() => {}} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Section/ }));
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Tab' });

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('closes on outside click', () => {
    render(
      <div>
        <FilterMultiSelect label="Section" values={[]} options={OPTIONS} allLabel="All" onChange={() => {}} />
        <button type="button">Outside</button>
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Section/ }));
    expect(screen.getByRole('listbox')).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));

    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('marks the trigger data-active only when at least one value is selected', () => {
    const { rerender } = render(
      <FilterMultiSelect
        label="Section"
        values={[]}
        options={OPTIONS}
        allLabel="All"
        onChange={() => {}}
        testId="section-multi"
      />,
    );

    expect(screen.getByTestId('section-multi').getAttribute('data-active')).toBeNull();

    rerender(
      <FilterMultiSelect
        label="Section"
        values={['hero']}
        options={OPTIONS}
        allLabel="All"
        onChange={() => {}}
        testId="section-multi"
      />,
    );

    expect(screen.getByTestId('section-multi').getAttribute('data-active')).toBe('true');
  });
});
