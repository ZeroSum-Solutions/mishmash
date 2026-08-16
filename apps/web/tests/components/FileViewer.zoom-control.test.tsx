// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';

// The preview zoom trigger renders `zoomPercentLabel(previewZoomPercent)` — a
// module-private helper in FileViewer.tsx with no direct unit test coverage.
// Rather than exporting a one-line formatter purely to reach it, this test
// drives the real zoom control (open menu -> pick a preset -> read the
// trigger's label back), which is the only way a user ever observes that
// value and was itself untested.

afterEach(() => {
  cleanup();
});

function htmlFile(name: string): ProjectFile {
  return {
    name,
    path: name,
    type: 'file',
    size: 512,
    mtime: 1710000000,
    kind: 'html',
    mime: 'text/html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Page',
      entry: name,
      renderer: 'html',
      exports: ['html'],
    },
  } as ProjectFile;
}

describe('FileViewer preview zoom control', () => {
  it('shows a whole-percent label and defaults to auto-fit (100% with no measured overflow)', () => {
    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlFile('zoom-default.html')}
        liveHtml="<html><body>hi</body></html>"
      />,
    );

    const trigger = screen.getByRole('button', { name: '100%' });
    expect(trigger.getAttribute('title')).toBe('Reset zoom');
  });

  it('switches to a manual zoom level and reflects it as the active, labeled selection', () => {
    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlFile('zoom-manual.html')}
        liveHtml="<html><body>hi</body></html>"
      />,
    );

    // The trigger's accessible name IS the zoom label itself ("100%", then
    // "75%"...), so it's queried by its stable `title` attribute instead.
    const trigger = screen.getByTitle('Reset zoom');
    fireEvent.click(trigger);

    const menu = screen.getByRole('menu');
    const seventyFive = within(menu).getByRole('menuitem', { name: '75%' });
    expect(seventyFive.className).not.toContain('active');

    fireEvent.click(seventyFive);

    // Picking a level closes the menu and relabels the trigger.
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger.textContent).toBe('75%');

    fireEvent.click(trigger);
    const reopenedMenu = screen.getByRole('menu');
    expect(within(reopenedMenu).getByRole('menuitem', { name: '75%' }).className).toContain('active');
    expect(within(reopenedMenu).getByRole('menuitem', { name: '100%' }).className).not.toContain('active');
  });
});
