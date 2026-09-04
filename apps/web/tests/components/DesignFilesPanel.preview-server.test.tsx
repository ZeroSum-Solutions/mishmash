// @vitest-environment jsdom

/**
 * Issue #158, the half a sandbox grant cannot fix: a mirrored site asks for
 * its assets by site-root path (`/_nuxt/entry.js`), the panel's srcdoc render
 * has no site root, and the page sits on its own loader with nothing on
 * screen to explain it. The panel must say why, and offer the project's own
 * preview server — the one surface that does serve from a root.
 */

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

import { DesignFilesPanel } from '../../src/components/DesignFilesPanel';
import { en } from '../../src/i18n/locales/en';
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

const ROOT_ABSOLUTE_PAGE =
  '<!doctype html><html><head><link rel="stylesheet" href="/_nuxt/entry.css"></head>' +
  '<body><script src="/_nuxt/entry.js"></script></body></html>';
const RELATIVE_PAGE =
  '<!doctype html><html><head><link rel="stylesheet" href="styles/site.css"></head>' +
  '<body><main>Hello</main></body></html>';

type PreviewRow = {
  id: string;
  url: string;
  port: number;
  frontServesRootAbsoluteAssets?: boolean;
};

function stubDaemon(options: { html: string; previews?: PreviewRow[]; openFails?: boolean }) {
  const opened: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/open')) {
      opened.push(url);
      if (options.openFails) {
        return new Response(
          JSON.stringify({ error: 'PREVIEW_OPEN_FAILED', url: 'http://127.0.0.1:8125/' }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ opened: true, url: 'http://127.0.0.1:8125/', browser: 'chrome' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('/previews')) {
      return new Response(JSON.stringify({ previews: options.previews ?? [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    void init;
    return new Response(options.html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { opened };
}

function htmlFile(): ProjectFile {
  return {
    name: 'index.html',
    path: 'index.html',
    type: 'file',
    size: 16 * 1024,
    mtime: 1700000000000,
    kind: 'html',
    mime: 'text/html',
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

function openPreviewOf(container: HTMLElement) {
  fireEvent.click(container.querySelector('.df-file-row .df-row-name-btn')!);
}

describe('Design Files panel preview server offer', () => {
  afterEach(() => {
    cleanup();
    lsStore.clear();
    vi.unstubAllGlobals();
  });

  it('explains a root-absolute page and points at the preview server', async () => {
    stubDaemon({ html: ROOT_ABSOLUTE_PAGE });
    const { container } = renderPanel([htmlFile()]);
    openPreviewOf(container);

    await waitFor(() => {
      expect(container.querySelector('[data-testid="design-file-preview-server"]')).toBeTruthy();
    });
    const offer = container.querySelector('[data-testid="design-file-preview-server"]')!;
    expect(offer.textContent).toContain(en['designFiles.previewServer.rootAbsolute']);
    expect(offer.textContent).toContain(en['designFiles.previewServer.none']);
  });

  it('stays silent for a page whose assets are all relative', async () => {
    stubDaemon({ html: RELATIVE_PAGE });
    const { container } = renderPanel([htmlFile()]);
    openPreviewOf(container);

    await waitFor(() => {
      expect(container.querySelector('.df-preview-thumb iframe')).toBeTruthy();
    });
    expect(container.querySelector('[data-testid="design-file-preview-server"]')).toBeNull();
  });

  it('offers a running preview server and hands a loopback URL to Chrome', async () => {
    const { opened } = stubDaemon({
      html: ROOT_ABSOLUTE_PAGE,
      previews: [{ id: 'pv1', url: 'http://127.0.0.1:8125/', port: 8125 }],
    });
    const { container } = renderPanel([htmlFile()]);
    openPreviewOf(container);

    await waitFor(() => {
      expect(container.querySelector('.df-preview-server-link')).toBeTruthy();
    });
    const link = container.querySelector<HTMLAnchorElement>('.df-preview-server-link')!;
    expect(link.getAttribute('href')).toBe('http://127.0.0.1:8125/');

    fireEvent.click(container.querySelector('.df-preview-server-chrome')!);
    await waitFor(() => {
      expect(opened).toEqual(['/api/projects/test-project/previews/pv1/open']);
    });
  });

  it('says so when the daemon could not start Chrome, instead of doing nothing', async () => {
    stubDaemon({
      html: ROOT_ABSOLUTE_PAGE,
      previews: [{ id: 'pv1', url: 'http://127.0.0.1:8125/', port: 8125 }],
      openFails: true,
    });
    const { container } = renderPanel([htmlFile()]);
    openPreviewOf(container);

    await waitFor(() => {
      expect(container.querySelector('.df-preview-server-chrome')).toBeTruthy();
    });
    expect(container.querySelector('.df-preview-server-failed')).toBeNull();

    fireEvent.click(container.querySelector('.df-preview-server-chrome')!);
    await waitFor(() => {
      expect(container.querySelector('.df-preview-server-failed')?.textContent)
        .toBe(en['designFiles.previewServer.openFailed']);
    });
  });

  it('links a tailnet-announced preview without offering Chrome on that machine', async () => {
    stubDaemon({
      html: ROOT_ABSOLUTE_PAGE,
      previews: [
        { id: 'pv1', url: 'http://devins-macbook-pro.tail908c18.ts.net:8125/', port: 8125 },
      ],
    });
    const { container } = renderPanel([htmlFile()]);
    openPreviewOf(container);

    await waitFor(() => {
      expect(container.querySelector('.df-preview-server-link')).toBeTruthy();
    });
    expect(container.querySelector<HTMLAnchorElement>('.df-preview-server-link')!.getAttribute('href'))
      .toBe('http://devins-macbook-pro.tail908c18.ts.net:8125/');
    expect(container.querySelector('.df-preview-server-chrome')).toBeNull();
  });

  /**
   * Under `tools-dev` the front is the Next dev server, which forwards only
   * `/api`, `/artifacts` and `/frames`, so the preview page's root-absolute
   * `/_nuxt/entry.js` never reaches the daemon's fallback and the page
   * half-renders. The daemon says so in the announcement; the panel must
   * repeat it rather than present the link as unconditionally working.
   */
  it('says a development front cannot serve the preview root-absolute assets', async () => {
    stubDaemon({
      html: ROOT_ABSOLUTE_PAGE,
      previews: [
        {
          id: 'pv1',
          url: 'http://localhost:17622/api/projects/test-project/previews/pv1/proxy/',
          port: 8125,
          frontServesRootAbsoluteAssets: false,
        },
      ],
    });
    const { container } = renderPanel([htmlFile()]);
    openPreviewOf(container);

    await waitFor(() => {
      expect(container.querySelector('.df-preview-server-link')).toBeTruthy();
    });
    const offer = container.querySelector('[data-testid="design-file-preview-server"]')!;
    expect(container.querySelector('.df-preview-server-front-limit')?.textContent ?? '')
      .toContain('cannot serve root-absolute assets');
    expect(offer.textContent).not.toContain(en['designFiles.previewServer.sharedLink']);
  });

  it('keeps the unconditional claim when the front does serve root-absolute assets', async () => {
    stubDaemon({
      html: ROOT_ABSOLUTE_PAGE,
      previews: [
        {
          id: 'pv1',
          url: 'http://devins-macbook-pro.tail908c18.ts.net:7443/api/projects/test-project/previews/pv1/proxy/',
          port: 8125,
          frontServesRootAbsoluteAssets: true,
        },
      ],
    });
    const { container } = renderPanel([htmlFile()]);
    openPreviewOf(container);

    await waitFor(() => {
      expect(container.querySelector('.df-preview-server-link')).toBeTruthy();
    });
    const offer = container.querySelector('[data-testid="design-file-preview-server"]')!;
    expect(offer.textContent).toContain(en['designFiles.previewServer.sharedLink']);
    expect(container.querySelector('.df-preview-server-front-limit')).toBeNull();
  });
});
