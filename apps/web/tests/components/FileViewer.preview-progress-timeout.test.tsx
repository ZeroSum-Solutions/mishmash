// @vitest-environment jsdom
// B-07 (issue #154) — a slow preview shows nothing and records nothing.
//
// A 40-image HTML artifact takes ~1.8 s to inline and hand to the iframe. For
// that whole window the FileViewer paints the `viewer-loading` gate, which
// carries decorative skeleton cards and an aria-label, and no text: on the
// light theme the user reads it as an empty white panel. If the pass never
// finishes, the gate never lifts. And nothing about any of it reaches the
// anomaly log — `.od/anomalies/anomalies.jsonl` holds 0 `preview-error` rows
// across 2384 records, because `trackIframeLoad` is wired only to the
// live-artifact frame and its timer is settled by the frame's own `load`
// event, which fires for the empty lazy-transport shell.
//
// These specs pin the three properties the fix has to provide:
//   1. the inliner reports how far along it is, with real counts;
//   2. a pass that runs past its budget shows the raw document plus a visible
//      warning instead of a gate that never lifts;
//   3. a frame that loaded but never received its artifact document is filed
//      as a `preview-error` anomaly, and one that DID receive it is not.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFile } from '../../src/types';

// Deferred control over inlineRelativeAssets, plus a handle on the `access`
// bag each call was given — that bag is where the progress sink has to live
// for the gate to be able to say "inlining 27 / 50".
const inlineState = vi.hoisted(() => ({
  pending: [] as Array<{
    resolve: (html: string) => void;
    reject: (err: unknown) => void;
    access: { onProgress?: (progress: { completed: number; total: number }) => void };
  }>,
  calls: 0,
}));

vi.mock('../../src/components/file-viewer-preview-assets', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/components/file-viewer-preview-assets')
  >();
  return {
    ...actual,
    inlineRelativeAssets: vi.fn(
      (
        _source: string,
        _projectId: string,
        _fileName: string,
        _paths: ReadonlySet<string> | null,
        access: { onProgress?: (progress: { completed: number; total: number }) => void },
      ) =>
        new Promise<string>((resolve, reject) => {
          inlineState.calls += 1;
          inlineState.pending.push({ resolve, reject, access });
        }),
    ),
  };
});

import { FileViewer } from '../../src/components/FileViewer';

/**
 * The navigation token the watchdog last asked this frame with. W2H.1: a
 * report settles only the arming it answers, so a healthy answer has to carry
 * it — see apps/web/src/observability/iframe-error.ts.
 */
function watchdogToken(frame: HTMLIFrameElement): string | undefined {
  const posted: Array<Record<string, unknown>> = [];
  Object.defineProperty(frame.contentWindow, 'postMessage', {
    configurable: true,
    value: (data: unknown) => posted.push(data as Record<string, unknown>),
  });
  frame.dispatchEvent(new Event('load'));
  const asks = posted.filter(
    (message) => message?.type === 'od:preview-content-size-request' && typeof message?.token === 'string',
  );
  return asks.length === 0 ? undefined : (asks[asks.length - 1]?.token as string);
}


const RAW_URL_PREFIX = '/api/projects/project-1/raw/';
const ANOMALY_ENDPOINT = '/api/anomalies';
const INLINE_MARKER = 'data-od-inline-asset';

// Five <section> elements clear the composition-metrics threshold, which
// disqualifies URL-load and pins the preview to srcDoc — the only transport
// that inlines assets at all.
const SECTIONS =
  '<section>1</section><section>2</section><section>3</section>' +
  '<section>4</section><section>5</section>';

function rawHtml(label: string): string {
  return `<html><head><link rel="stylesheet" href="styles.css"></head><body><h1>${label}</h1>${SECTIONS}</body></html>`;
}

function inlinedHtml(label: string): string {
  return `<html><head><style ${INLINE_MARKER}="styles.css">h1{color:red}</style></head><body><h1>${label}</h1>${SECTIONS}</body></html>`;
}

function htmlFile(name = 'preview.html'): ProjectFile {
  return {
    name,
    path: name,
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    kind: 'html',
    mime: 'text/html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Preview',
      entry: name,
      renderer: 'html',
      exports: ['html'],
    },
  };
}

interface RecordedCall {
  url: string;
  body: string | null;
}

function stubFetch(html: string): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : null });
      if (url.startsWith(RAW_URL_PREFIX)) return new Response(html, { status: 200 });
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

function previewFrame(): HTMLIFrameElement | null {
  return screen.queryByTestId('artifact-preview-frame') as HTMLIFrameElement | null;
}

function frameSrcDoc(): string {
  return previewFrame()?.getAttribute('srcDoc') ?? '';
}

async function settleNextInline(html: string) {
  const next = inlineState.pending.shift();
  if (!next) throw new Error('no pending inlineRelativeAssets call');
  await act(async () => {
    next.resolve(html);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  // `shouldAdvanceTime` keeps Testing Library's own `waitFor` polling alive
  // while the component's 1 s / budget timers stay under the test's control.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  inlineState.pending = [];
  inlineState.calls = 0;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('preview asset inlining reports its own progress', () => {
  it('gives the inliner a progress sink that counts settled assets against the total', async () => {
    const rawUrl = (_projectId: string, filePath: string) => `http://preview.test/raw/${filePath}`;
    const fetchFixture: typeof globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('styles.css')) {
        return new Response('body{color:red}', { headers: { 'content-type': 'text/css' } });
      }
      if (url.endsWith('app.js')) {
        return new Response('window.ok = 1;', { headers: { 'content-type': 'text/javascript' } });
      }
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { 'content-type': 'image/png' },
      });
    };
    const reports: Array<{ completed: number; total: number }> = [];

    // The real module, not the deferred mock the FileViewer specs below use.
    const previewAssets = await vi.importActual<
      typeof import('../../src/components/file-viewer-preview-assets')
    >('../../src/components/file-viewer-preview-assets');

    await previewAssets.inlineRelativeAssets(
      '<html><head><link rel="stylesheet" href="styles.css"></head>' +
        '<body><img src="logo.png"><script src="app.js"></script></body></html>',
      'project-1',
      'index.html',
      new Set(['index.html', 'styles.css', 'logo.png', 'app.js']),
      {
        fetch: fetchFixture,
        rawUrl,
        onProgress: (progress) => reports.push(progress),
      },
    );

    // Three referenced assets: one stylesheet, one image, one script. The
    // gate's "inlining 27 / 50" copy has to come from here, so the sink must
    // be called and its last report must be complete.
    expect(reports.length).toBeGreaterThan(0);
    expect(reports[reports.length - 1]).toEqual({ completed: 3, total: 3 });
    expect(reports.every((report) => report.completed <= report.total)).toBe(true);
  });
});

describe('a slow preview says what it is doing instead of showing a blank gate', () => {
  it('puts the inliner progress counts in the loading gate once the pass runs past a second', async () => {
    stubFetch(rawHtml('Slow'));

    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />);

    await waitFor(() => expect(inlineState.calls).toBe(1));
    const pass = inlineState.pending[0];
    expect(pass).toBeDefined();

    // The inliner reports 2 of 5 assets settled while the pass is still open.
    await act(async () => {
      pass?.access.onProgress?.({ completed: 2, total: 5 });
    });

    // Under a second, the gate stays quiet: a status line that flashes on
    // every fast preview is noise, not feedback.
    await advance(400);
    expect(screen.queryByTestId('preview-inline-progress')).toBeNull();

    await advance(900);

    const status = await screen.findByTestId('preview-inline-progress');
    expect(status.textContent).toContain('2');
    expect(status.textContent).toContain('5');
  });

  it('renders the raw document with a visible warning when the pass runs past its budget', async () => {
    stubFetch(rawHtml('Budget'));

    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />);

    await waitFor(() => expect(inlineState.calls).toBe(1));
    expect(previewFrame()).toBeNull();

    // The pass never settles. Past the budget the user must get the document
    // itself — unstyled but visible — and be told why it looks wrong.
    await advance(16_000);

    await waitFor(() => expect(previewFrame()).not.toBeNull());
    expect(frameSrcDoc()).toContain('Budget');
    expect(frameSrcDoc()).not.toContain(INLINE_MARKER);
    const warning = screen.getByTestId('preview-inline-timeout-warning');
    expect(warning).toHaveAttribute('role', 'alert');
    expect(warning.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it('leaves a finished preview alone once its budgets have run out on the clock', async () => {
    // The effect does not re-run on its own resolution, so a budget timer left
    // armed after the pass settles would fire over a working preview: a false
    // "assets did not finish" alert, and the inlined document swapped back to
    // the raw one fifteen seconds after it painted.
    stubFetch(rawHtml('Settled'));

    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />);

    await waitFor(() => expect(inlineState.calls).toBe(1));
    await settleNextInline(inlinedHtml('Settled'));
    await waitFor(() => expect(frameSrcDoc()).toContain(INLINE_MARKER));

    await advance(20_000);

    expect(frameSrcDoc()).toContain(INLINE_MARKER);
    expect(frameSrcDoc()).toContain('Settled');
    expect(screen.queryByTestId('preview-inline-timeout-warning')).toBeNull();
    expect(screen.queryByTestId('preview-inline-progress')).toBeNull();
  });
});

describe('a preview that never paints becomes a preview-error record', () => {
  it('files a preview-error when the frame loaded but its artifact document never reported', async () => {
    const calls = stubFetch(rawHtml('Stuck'));

    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />);

    await waitFor(() => expect(inlineState.calls).toBe(1));
    await settleNextInline(inlinedHtml('Stuck'));
    await waitFor(() => expect(previewFrame()).not.toBeNull());

    // The frame's own load event fires for the shell document. It is not
    // proof the artifact ever appeared, so it must not settle the watchdog.
    const frame = previewFrame() as HTMLIFrameElement;
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

  it('files nothing when the artifact document reports itself into the frame', async () => {
    const calls = stubFetch(rawHtml('Painted'));

    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />);

    await waitFor(() => expect(inlineState.calls).toBe(1));
    await settleNextInline(inlinedHtml('Painted'));
    await waitFor(() => expect(previewFrame()).not.toBeNull());

    const frame = previewFrame() as HTMLIFrameElement;
    let token: string | undefined;
    await act(async () => {
      token = watchdogToken(frame);
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'od:preview-content-size', width: 1280, painted: true, token },
          source: frame.contentWindow,
        }),
      );
    });

    await advance(16_000);

    expect(previewErrorAnomalies(calls)).toHaveLength(0);
  });
});
