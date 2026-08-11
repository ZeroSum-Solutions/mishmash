// @vitest-environment jsdom

// LibraryRail is a pure props-in component (no data fetching), so it's
// covered directly against the LibraryRailCounts shape rather than through
// the full LibrarySection + mocked registry.

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LibraryRail } from '../../../src/components/library/LibraryRail';
import type { LibraryRailCounts } from '../../../src/components/library/library-utils';

afterEach(() => {
  cleanup();
});

const counts: LibraryRailCounts = {
  total: 5,
  byKind: { image: 3, video: 1, html: 1 },
  generated: 2,
};

function renderRail(overrides: Partial<React.ComponentProps<typeof LibraryRail>> = {}) {
  const props: React.ComponentProps<typeof LibraryRail> = {
    search: '',
    onSearchChange: vi.fn(),
    activeKind: '',
    activeGenerated: false,
    onSelectAll: vi.fn(),
    onSelectKind: vi.fn(),
    onSelectGenerated: vi.fn(),
    grandTotal: 5,
    counts,
    ...overrides,
  };
  render(<LibraryRail {...props} />);
  return props;
}

describe('LibraryRail', () => {
  it('shows the grand total on All Assets and a per-kind count for each type bucket', () => {
    renderRail();
    expect(screen.getByRole('button', { name: 'All Assets (5)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Image (3)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Video (1)' })).toBeTruthy();
    // A kind with zero assets in the current snapshot still renders, at 0 —
    // it must not disappear from navigation just because nothing loaded yet.
    expect(screen.getByRole('button', { name: 'Font (0)' })).toBeTruthy();
  });

  it('gives the "Generated" entry its own count, independent of kind counts', () => {
    renderRail();
    expect(screen.getByRole('button', { name: 'Generated (2)' })).toBeTruthy();
  });

  it('calls onSelectKind with the badge kind when a type bucket is clicked', () => {
    const props = renderRail();
    fireEvent.click(screen.getByRole('button', { name: 'Video (1)' }));
    expect(props.onSelectKind).toHaveBeenCalledWith('video');
  });

  it('calls onSelectGenerated when the Generated entry is clicked', () => {
    const props = renderRail();
    fireEvent.click(screen.getByRole('button', { name: 'Generated (2)' }));
    expect(props.onSelectGenerated).toHaveBeenCalledTimes(1);
  });

  it('calls onSelectAll when All Assets is clicked', () => {
    const props = renderRail();
    fireEvent.click(screen.getByRole('button', { name: 'All Assets (5)' }));
    expect(props.onSelectAll).toHaveBeenCalledTimes(1);
  });

  it('marks the active kind bucket, not the others', () => {
    renderRail({ activeKind: 'video' });
    expect(screen.getByRole('button', { name: 'Video (1)' }).getAttribute('data-active')).toBe('true');
    expect(screen.getByRole('button', { name: 'Image (3)' }).getAttribute('data-active')).toBe('false');
  });

  it('marks Generated active (and no kind active) when activeGenerated is set', () => {
    renderRail({ activeGenerated: true, activeKind: '' });
    expect(screen.getByRole('button', { name: 'Generated (2)' }).getAttribute('data-active')).toBe('true');
    expect(screen.getByRole('button', { name: 'Image (3)' }).getAttribute('data-active')).toBe('false');
  });

  it('always renders the Collections empty state — no backing data model in this pass', () => {
    renderRail();
    expect(screen.getByText('Create one to stay organized')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New collection' })).toHaveProperty('disabled', true);
  });

  it('routes typing in the search box through onSearchChange', () => {
    const props = renderRail();
    fireEvent.change(screen.getByPlaceholderText('Search Assets…'), { target: { value: 'logo' } });
    expect(props.onSearchChange).toHaveBeenCalledWith('logo');
  });
});
