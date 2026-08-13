// @vitest-environment jsdom

// The Home restructure (#111) added a Templates rail button after Projects
// without removing the original one below Design systems (#105), leaving two
// identical destinations (same view, same testId) in the rail. This pins the
// rail to exactly one Templates entry — the primary-group placement.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EntryNavRail } from '../../src/components/EntryNavRail';

describe('EntryNavRail templates destination', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders exactly one Templates button', () => {
    render(
      <EntryNavRail
        view="home"
        onViewChange={() => {}}
        onNewProject={() => {}}
        open
        onClose={() => {}}
      />,
    );
    expect(screen.getAllByTestId('entry-nav-templates')).toHaveLength(1);
  });

  it('renders visible-label content for the compact navigation drawer', () => {
    render(
      <EntryNavRail
        view="home"
        onViewChange={() => {}}
        onNewProject={() => {}}
        open
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId('entry-nav-projects').querySelector('.entry-nav-rail__label')?.textContent)
      .toBe('Projects');
  });

  it('closes the drawer after compact navigation', () => {
    const onClose = vi.fn();
    const onViewChange = vi.fn();
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));

    render(
      <EntryNavRail
        view="home"
        onViewChange={onViewChange}
        onNewProject={() => {}}
        open
        onClose={onClose}
      />,
    );

    screen.getByTestId('entry-nav-projects').click();
    expect(onViewChange).toHaveBeenCalledWith('projects');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
