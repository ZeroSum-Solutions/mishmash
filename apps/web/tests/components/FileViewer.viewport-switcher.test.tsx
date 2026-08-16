// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';

// The preview viewport switcher (PreviewViewportControls, an internal component
// of FileViewer.tsx) drives the desktop/tablet/mobile preset picker in the
// toolbar. Its underlying math (effectivePreviewScale, previewOverlayTransform,
// desktopPreviewAutoFitZoomPercent) is unit-tested elsewhere; this file
// exercises the actual interactive control — opening the menu, selecting a
// preset, and reading back the resulting selection/icon state — which had no
// coverage.

afterEach(() => {
  cleanup();
});

// The selected viewport preset is cached per (projectId, file) in a
// module-level Map (`htmlPreviewViewportState`) so it survives a
// remount — real, intentional behavior (reopening a file keeps your last
// viewport choice). That same persistence means two tests reusing the same
// file name in this suite would leak state into each other, so every test
// below renders a distinctly named file to stay isolated.
function htmlFile(name: string, overrides: Partial<ProjectFile> = {}): ProjectFile {
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
    ...overrides,
  } as ProjectFile;
}

describe('FileViewer device viewport switcher', () => {
  it('defaults to the desktop preset with the computer icon', () => {
    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlFile('default.html')}
        liveHtml="<html><body>hi</body></html>"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Preview viewport' });
    expect(within(trigger).getByText('Desktop')).toBeTruthy();
    expect(trigger.querySelector('.ri-computer-line')).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens the preset menu and switches to tablet, updating the trigger label and icon', () => {
    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlFile('switch-tablet.html')}
        liveHtml="<html><body>hi</body></html>"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Preview viewport' });
    fireEvent.click(trigger);

    const listbox = screen.getByRole('listbox', { name: 'Preview viewport' });
    const options = within(listbox).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Desktop', 'Tablet', 'Mobile']);
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    expect(options[1]?.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(within(listbox).getByRole('option', { name: /Tablet/ }));

    // Selecting a preset closes the menu.
    expect(screen.queryByRole('listbox', { name: 'Preview viewport' })).toBeNull();
    expect(within(trigger).getByText('Tablet')).toBeTruthy();
    expect(trigger.querySelector('.ri-tablet-line')).toBeTruthy();
    expect(trigger.querySelector('.ri-computer-line')).toBeNull();
  });

  it('reflects the mobile preset as selected after choosing it, and desktop as no longer selected', () => {
    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlFile('switch-mobile.html')}
        liveHtml="<html><body>hi</body></html>"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Preview viewport' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: /Mobile/ }));

    fireEvent.click(trigger);
    const listbox = screen.getByRole('listbox', { name: 'Preview viewport' });
    const desktopOption = within(listbox).getByRole('option', { name: /Desktop/ });
    const mobileOption = within(listbox).getByRole('option', { name: /Mobile/ });
    expect(desktopOption.getAttribute('aria-selected')).toBe('false');
    expect(mobileOption.getAttribute('aria-selected')).toBe('true');
  });

  it('closes the menu on Escape without changing the selected preset', () => {
    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlFile('escape.html')}
        liveHtml="<html><body>hi</body></html>"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Preview viewport' });
    fireEvent.click(trigger);
    expect(screen.getByRole('listbox', { name: 'Preview viewport' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('listbox', { name: 'Preview viewport' })).toBeNull();
    expect(within(trigger).getByText('Desktop')).toBeTruthy();
  });

  it('restores the cached viewport preset when the same file is closed and reopened', () => {
    // This is the feature's own headline contract ("choice is cached per
    // project+file" -- docs/canvas-feature-inventory.json, device-viewport-switcher).
    // Unlike every other test in this file, it deliberately reuses the SAME
    // file across an unmount/remount to prove the module-level cache
    // (htmlPreviewViewportState) round-trips through a real close/reopen,
    // not just that the in-memory state object updates while mounted.
    const file = htmlFile('persist.html');

    const first = render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        liveHtml="<html><body>hi</body></html>"
      />,
    );

    const firstTrigger = screen.getByRole('button', { name: 'Preview viewport' });
    fireEvent.click(firstTrigger);
    fireEvent.click(screen.getByRole('option', { name: /Mobile/ }));
    expect(within(firstTrigger).getByText('Mobile')).toBeTruthy();

    // Close the file tab.
    first.unmount();

    // Reopen the same file (same projectId + file identity).
    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={file}
        liveHtml="<html><body>hi</body></html>"
      />,
    );

    const reopenedTrigger = screen.getByRole('button', { name: 'Preview viewport' });
    expect(within(reopenedTrigger).getByText('Mobile')).toBeTruthy();
    expect(reopenedTrigger.querySelector('.ri-smartphone-line')).toBeTruthy();
  });
});
