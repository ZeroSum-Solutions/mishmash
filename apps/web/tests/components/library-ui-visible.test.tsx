// @vitest-environment jsdom

// BUG-6: `LIBRARY_UI_VISIBLE = false` with no env override hid the entire
// Library web surface (grid, preview, upload, picker, nav entry, `/library`
// route) while the HTTP, CLI, and clipper-ingest surfaces stayed fully
// functional. Every gated surface reads the same shared flag
// (`apps/web/src/features/libraryUi.ts`), so this spec pins the flag's
// default plus its two cheapest observable effects: the `/library` deep
// link resolving to the Library view (router.ts), and the nav rail actually
// rendering the Library entry point (EntryNavRail.tsx) users click to get
// there.

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LIBRARY_UI_VISIBLE } from '../../src/features/libraryUi';
import { buildPath, parseRoute } from '../../src/router';
import { EntryNavRail } from '../../src/components/EntryNavRail';

describe('Library UI visibility (BUG-6)', () => {
  it('ships enabled by default', () => {
    expect(LIBRARY_UI_VISIBLE).toBe(true);
  });

  it('resolves the /library deep link to the Library home view', () => {
    expect(parseRoute('/library')).toEqual({ kind: 'home', view: 'library' });
    expect(buildPath({ kind: 'home', view: 'library' })).toBe('/library');
  });

  describe('nav rail entry point', () => {
    afterEach(() => {
      cleanup();
    });

    it('renders the Library destination so users can actually reach it', () => {
      render(
        <EntryNavRail
          view="home"
          onViewChange={() => {}}
          onNewProject={() => {}}
          open
          onClose={() => {}}
        />,
      );
      expect(screen.getByTestId('entry-nav-library')).toBeTruthy();
    });
  });
});
