// @vitest-environment jsdom

// The Home restructure (#111) added a Templates rail button after Projects
// without removing the original one below Design systems (#105), leaving two
// identical destinations (same view, same testId) in the rail. This pins the
// rail to exactly one Templates entry — the primary-group placement.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EntryNavRail } from '../../src/components/EntryNavRail';

describe('EntryNavRail templates destination', () => {
  afterEach(() => {
    cleanup();
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
});
