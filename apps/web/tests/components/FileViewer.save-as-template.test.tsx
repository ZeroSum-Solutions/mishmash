// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { saveTemplateMock } = vi.hoisted(() => ({
  saveTemplateMock: vi.fn(),
}));

vi.mock('../../src/state/projects', async () => {
  const actual = await vi.importActual<typeof import('../../src/state/projects')>(
    '../../src/state/projects',
  );
  return {
    ...actual,
    saveTemplate: saveTemplateMock,
  };
});

import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  saveTemplateMock.mockReset();
});

function templateableFile(): ProjectFile {
  return {
    name: 'landing-page.html',
    path: 'landing-page.html',
    type: 'file',
    size: 512,
    mtime: 1710000000,
    kind: 'html',
    mime: 'text/html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Landing Page',
      entry: 'landing-page.html',
      renderer: 'html',
      exports: ['html'],
    },
  } as ProjectFile;
}

function openTemplateModal() {
  render(
    <FileViewer projectId="project-1" projectKind="prototype" file={templateableFile()}
      liveHtml="<html><body><h1>Hello</h1></body></html>"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /download/i }));
  fireEvent.click(screen.getByRole('menuitem', { name: /save as template/i }));
}

describe('FileViewer save-as-template failure handling', () => {
  it('shows an error and keeps the modal open when the daemon reports save failure', async () => {
    // saveTemplate() resolving to a falsy value is the daemon-side "save
    // failed" signal (see handleSaveAsTemplate's `if (!tpl)` branch) — this
    // is distinct from a thrown network error and needs its own coverage.
    saveTemplateMock.mockResolvedValueOnce(null);

    openTemplateModal();

    const nameInput = screen.getByLabelText(/template name/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Landing Page' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(saveTemplateMock).toHaveBeenCalled();
    });

    // The modal must still be showing — a failed save is not a successful
    // dismissal — with an error message the user can act on.
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText(/template name/i)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('Could not save template — try again.')).toBeTruthy();
    });
  });

  it('does not call saveTemplate when the name field is blank', async () => {
    openTemplateModal();

    const nameInput = screen.getByLabelText(/template name/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // handleSaveAsTemplate trims the name and no-ops on empty — guards
    // against firing a request the daemon would just reject.
    expect(saveTemplateMock).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('re-enables the Save button and clears the prior error after a failed save is retried successfully', async () => {
    saveTemplateMock.mockResolvedValueOnce(null);
    saveTemplateMock.mockResolvedValueOnce({
      id: 'tpl_1',
      name: 'Landing Page',
      description: null,
      sourceProjectId: 'project-1',
      files: [],
      createdAt: Date.now(),
    });

    openTemplateModal();

    const nameInput = screen.getByLabelText(/template name/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Landing Page' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(screen.getByText('Could not save template — try again.')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(saveTemplateMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
