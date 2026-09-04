// @vitest-environment jsdom
// W2H.1 red spec — the powered cross-origin copy is a visible preview too.
//
// W2G.1 left this transport on `load` with a stated reason: the daemon injects
// the same `od:preview-content-size` producer into the powered response, but
// nothing had confirmed the report crosses back from the isolated origin under
// that sandbox. `load` is the evidence `iframe-error.ts` itself calls weak — it
// fires for a 200 that rendered nothing — so a powered artifact that never
// paints is recorded nowhere and named nowhere.
//
// e2e/ui/powered-preview-paint-report.test.ts is the browser half: it proves in
// a real browser that the report DOES cross back from the powered origin. These
// specs are the host half: the powered frame is asked, and a powered preview
// that never reports is filed as a `preview-error` and named on screen.

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileViewer } from '../../src/components/FileViewer';
import { __resetPreviewIsolationCache } from '../../src/runtime/powered-preview';
import type { ProjectFile } from '../../src/types';

const ANOMALY_ENDPOINT = '/api/anomalies';
const REPORT_REQUEST = 'od:preview-content-size-request';
const NO_RENDER_NOTICE = 'preview-no-render-notice';
// Wants SharedArrayBuffer, so the render-mode decision routes it to the
// powered cross-origin copy.
const POWERED_HTML = '<html><body><script>new SharedArrayBuffer(8)</script></body></html>';

interface RecordedCall {
  url: string;
  body: string | null;
}

function poweredFile(): ProjectFile {
  return {
    name: 'worker.html',
    path: 'worker.html',
    type: 'file',
    size: POWERED_HTML.length,
    mtime: 1_710_000_000,
    kind: 'html',
    mime: 'text/html',
  };
}

function stubFetch(): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : null });
      if (url.includes('/api/preview/isolation')) {
        return new Response(
          JSON.stringify({ supported: true, baseOrigin: 'http://127.0.0.1:43111' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === ANOMALY_ENDPOINT) return new Response('{"ok":true}', { status: 200 });
      if (url.includes('/files')) {
        return new Response(JSON.stringify({ files: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
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

async function renderPoweredPreview(): Promise<{
  frame: HTMLIFrameElement;
  posted: Array<Record<string, unknown>>;
}> {
  render(
    <FileViewer
      projectId="project-1"
      projectKind="prototype"
      file={poweredFile()}
      liveHtml={POWERED_HTML}
    />,
  );
  await waitFor(() => {
    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    expect(frame.getAttribute('data-od-powered')).toBe('true');
  });
  const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
  const posted: Array<Record<string, unknown>> = [];
  Object.defineProperty(frame.contentWindow, 'postMessage', {
    configurable: true,
    value: (data: unknown) => posted.push(data as Record<string, unknown>),
  });
  return { frame, posted };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  __resetPreviewIsolationCache();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('the powered preview transport proves it painted', () => {
  it('asks the powered frame to report itself', async () => {
    stubFetch();
    const { frame, posted } = await renderPoweredPreview();

    await act(async () => {
      frame.dispatchEvent(new Event('load'));
    });

    // A request that carries a navigation token is the watchdog's ask. The
    // untokened one the zoom-fitting measurement posts is a different caller
    // and proves nothing about this transport's evidence.
    expect(
      posted.filter(
        (message) => message?.type === REPORT_REQUEST && typeof message?.token === 'string',
      ),
      'the daemon injects the producer into the powered response; the host has to ask for it',
    ).not.toHaveLength(0);
  });

  it('names the failure and files a preview-error when the powered copy never reports', async () => {
    const calls = stubFetch();
    const { frame } = await renderPoweredPreview();

    await act(async () => {
      frame.dispatchEvent(new Event('load'));
    });
    await advance(16_000);

    expect(previewErrorAnomalies(calls)).toHaveLength(1);
    expect(screen.getByTestId(NO_RENDER_NOTICE)).toBeTruthy();
  });
});
