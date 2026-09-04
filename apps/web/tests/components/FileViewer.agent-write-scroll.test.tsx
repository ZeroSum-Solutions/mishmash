// @vitest-environment jsdom
//
// B-09, second half: "an agent write never … resets their scroll position".
//
// A `file-changed` burst bumps `filesRefreshKey`, and the viewer answers it by
// replacing the preview's src (`&fr=<key>`) so a changed dependency — a
// stylesheet, an image, a module the open page renders — refreshes with it.
// Every reload the user asks for snapshots their place first
// (`capturePreviewScrollPosition`); this one is the only reload they did not
// ask for, so it has to snapshot too, or an agent write throws away where they
// were reading.

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';

const RAW_URL = '/api/projects/project-1/raw/index.html';

const PAGE_HTML = '<html><body><h1>Gallery</h1><p>a long page</p></body></html>';

function pageFile(): ProjectFile {
  return {
    name: 'index.html',
    path: 'index.html',
    type: 'file',
    size: PAGE_HTML.length,
    mtime: 1_710_000_000,
    kind: 'html',
    mime: 'text/html',
  };
}

function fetchReturningPage() {
  return vi.fn(async (input: string | URL | Request) => {
    const url =
      typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    if (url.startsWith(RAW_URL)) return new Response(PAGE_HTML, { status: 200 });
    return new Response('', { status: 404 });
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('FileViewer preview scroll across an agent-write live-reload (B-09)', () => {
  it('snapshots the reader position before the file-change reload replaces the preview src', async () => {
    vi.stubGlobal('fetch', fetchReturningPage());

    const { rerender } = render(
      <FileViewer projectId="project-1" projectKind="prototype" file={pageFile()} isDeck={false} />,
    );

    await waitFor(() => expect(screen.getByTestId('artifact-preview-frame')).toBeTruthy());

    // The reader has scrolled down the preview canvas.
    const previewBody = document.querySelector('.viewer-body') as HTMLElement;
    expect(previewBody).toBeTruthy();
    previewBody.scrollTop = 640;
    previewBody.scrollLeft = 0;
    const scrollTo = vi.fn();
    Object.defineProperty(previewBody, 'scrollTo', { value: scrollTo, configurable: true });

    // An agent write lands: the coalesced refresh bumps the key the viewer
    // watches. The reload is deferred by 180 ms inside the viewer.
    vi.useFakeTimers();
    rerender(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={pageFile()}
        isDeck={false}
        filesRefreshKey={1}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
    vi.useRealTimers();

    // The frame finishes loading the replaced src; the viewer restores the
    // snapshot it took before the replace.
    act(() => {
      screen.getByTestId('artifact-preview-frame').dispatchEvent(new Event('load'));
    });

    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
    expect(scrollTo).toHaveBeenCalledWith(0, 640);
  });
});
