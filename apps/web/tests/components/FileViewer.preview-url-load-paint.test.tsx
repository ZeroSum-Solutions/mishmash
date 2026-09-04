// @vitest-environment jsdom
// W2G.1 / F2 — the URL-load transport is a visible preview and reports no paint.
//
// Track 2.1 wired `trackIframeLoad` to exactly two frames: the live-artifact
// iframe and the srcDoc iframe. The srcDoc watchdog returns without installing
// whenever `useUrlLoadPreview` is true, so the transport that carries most
// multi-file artifacts — a plain `<iframe src="/api/projects/:id/raw/:file">` —
// is instrumented by nothing at all. A URL-load preview that answers 200 and
// then paints nothing is invisible to the anomaly log, which is why
// `.od/anomalies/anomalies.jsonl` holds 0 `preview-error` rows across 2443
// records.
//
// The daemon already injects the `od:preview-content-size` producer into this
// transport's response (`URL_PREVIEW_SCROLL_BRIDGE`, applied because the
// preview URL carries `PREVIEW_BRIDGE_QUERY`), so the frame can prove its own
// document ran. These specs pin both directions: a frame that never reports is
// filed, and one that does report is left alone.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileViewer } from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';

const RAW_URL_PREFIX = '/api/projects/project-1/raw/';
const ANOMALY_ENDPOINT = '/api/anomalies';
const DOCUMENT_REPORT = 'od:preview-content-size';

// No <section> elements, no tweaks template, no root-relative refs: nothing
// disqualifies URL-load, so this file previews through the URL transport.
const PAGE_HTML = '<html><body><h1>Landing</h1><p>one flat page</p></body></html>';

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

interface RecordedCall {
  url: string;
  body: string | null;
}

function stubFetch(): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : null });
      if (url.startsWith(RAW_URL_PREFIX)) return new Response(PAGE_HTML, { status: 200 });
      if (url === ANOMALY_ENDPOINT) return new Response('{"ok":true}', { status: 200 });
      return new Response('', { status: 404 });
    }),
  );
  return calls;
}

function previewErrorAnomalies(calls: readonly RecordedCall[]): Array<Record<string, unknown>> {
  return calls
    .filter((call) => call.url === ANOMALY_ENDPOINT && call.body != null)
    .map((call) => JSON.parse(call.body as string) as Record<string, unknown>)
    .filter((record) => record.kind === 'preview-error');
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the URL-load preview transport reports its own paint', () => {
  it('files a preview-error when the url-loaded document never reports itself', async () => {
    const calls = stubFetch();

    render(<FileViewer projectId="project-1" projectKind="prototype" file={pageFile()} />);

    const frame = (await screen.findByTestId('artifact-preview-frame')) as HTMLIFrameElement;
    // This is the URL transport, not srcDoc: it has a src and no srcDoc.
    expect(frame.getAttribute('data-od-render-mode')).toBe('url-load');

    // The frame's own load event fires for a 200 that rendered nothing and for
    // a document whose subresources were all refused. It is not paint evidence.
    await act(async () => {
      fireEvent.load(frame);
    });
    expect(previewErrorAnomalies(calls)).toHaveLength(0);

    await advance(16_000);

    const filed = previewErrorAnomalies(calls);
    expect(filed).toHaveLength(1);
    expect(filed[0]?.severity).toBe('warn');
    expect(String(filed[0]?.summary)).toMatch(/preview/i);
  });

  it('files nothing when the url-loaded document reports itself into the frame', async () => {
    const calls = stubFetch();

    render(<FileViewer projectId="project-1" projectKind="prototype" file={pageFile()} />);

    const frame = (await screen.findByTestId('artifact-preview-frame')) as HTMLIFrameElement;

    await act(async () => {
      fireEvent.load(frame);
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: DOCUMENT_REPORT, width: 1280 },
          source: frame.contentWindow,
        }),
      );
    });

    await advance(16_000);

    expect(previewErrorAnomalies(calls)).toHaveLength(0);
  });

  it('stops watching the url frame once the viewer unmounts', async () => {
    // A watchdog that outlives its frame files a timeout for a preview nobody
    // is looking at any more.
    const calls = stubFetch();

    const { unmount } = render(
      <FileViewer projectId="project-1" projectKind="prototype" file={pageFile()} />,
    );
    await screen.findByTestId('artifact-preview-frame');

    unmount();
    await advance(16_000);

    expect(previewErrorAnomalies(calls)).toHaveLength(0);
  });
});

