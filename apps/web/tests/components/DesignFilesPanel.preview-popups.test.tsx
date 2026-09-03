// @vitest-environment jsdom

/**
 * Red spec for issue #158: `target="_blank"` links inside the Design Files
 * panel preview are dead.
 *
 * The srcdoc shim the panel injects (`apps/web/src/runtime/srcdoc.ts`)
 * intercepts a `_blank` click and calls `window.open`. A sandboxed iframe
 * that was not granted `allow-popups` (and, since the frame has an opaque
 * origin, `allow-popups-to-escape-sandbox`) drops that call silently, so a
 * launcher page cannot hand the user off to a real tab. The panels that
 * already work — `PreviewModal` and `FileWorkspace` — grant both.
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

import { DesignFilesPanel } from '../../src/components/DesignFilesPanel';
import type { ProjectFile } from '../../src/types';

const lsStore = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => lsStore.get(key) ?? null,
  setItem: (key: string, value: string) => {
    lsStore.set(key, value);
  },
  removeItem: (key: string) => {
    lsStore.delete(key);
  },
  clear: () => {
    lsStore.clear();
  },
});

function htmlFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    name: 'index.html',
    path: 'index.html',
    type: 'file',
    size: 16 * 1024,
    mtime: 1700000000000,
    kind: 'html',
    mime: 'text/html',
    ...overrides,
  };
}

function renderPanel(
  files: ProjectFile[],
  overrides: Partial<ComponentProps<typeof DesignFilesPanel>> = {},
) {
  return render(
    <DesignFilesPanel
      projectId="test-project"
      files={files}
      liveArtifacts={[]}
      onRefreshFiles={vi.fn()}
      onOpenFile={vi.fn()}
      onOpenLiveArtifact={vi.fn()}
      onRenameFile={vi.fn()}
      onDeleteFile={vi.fn()}
      onDeleteFiles={vi.fn()}
      onUpload={vi.fn()}
      onUploadFiles={vi.fn()}
      onPaste={vi.fn()}
      onNewSketch={vi.fn()}
      onClearUploadError={vi.fn()}
      {...overrides}
    />,
  );
}

describe('Design Files panel preview sandbox', () => {
  afterEach(() => {
    cleanup();
    lsStore.clear();
    vi.unstubAllGlobals();
  });

  it('grants the popup permissions the srcdoc shim needs to open _blank links', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            '<!doctype html><html><body><a href="https://example.com" target="_blank">Open</a></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          ),
      ),
    );

    const { container } = renderPanel([htmlFile()]);
    fireEvent.click(container.querySelector('.df-file-row .df-row-name-btn')!);

    await waitFor(() => {
      expect(container.querySelector('.df-preview-thumb iframe')).toBeTruthy();
    });

    const sandbox = container
      .querySelector<HTMLIFrameElement>('.df-preview-thumb iframe')!
      .getAttribute('sandbox');
    const tokens = (sandbox ?? '').split(/\s+/).filter(Boolean);

    expect(tokens).toContain('allow-popups');
    expect(tokens).toContain('allow-popups-to-escape-sandbox');
    // The permissions the panel already had must survive the grant.
    expect(tokens).toContain('allow-scripts');
    expect(tokens).toContain('allow-downloads');
  });
});
