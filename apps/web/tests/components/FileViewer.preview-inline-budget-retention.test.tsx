// @vitest-environment jsdom
// W2G.1 / F5 — a slow revalidation throws away a working render.
//
// Track 2.3 coalesces a `file-changed` burst and bumps `filesRefresh`, which
// resets the project file set and restarts track 2.1's inlining pass. When that
// pass runs past `PREVIEW_INLINE_TIMEOUT_MS` the budget branch calls
// `setInlinedSource({ key, forSource: source, value: source })` unconditionally,
// so a styled page that was rendering perfectly is replaced by its raw source
// because a re-inline after an agent write took too long.
//
// The effect's own comments already argue for continuity in the neighbouring
// branch ("hold the last good render rather than blank the canvas"); the
// timeout branch contradicts them. These specs pin the corrected rule: on
// timeout, keep an existing render for the SAME file and show the warning;
// substitute raw source only when this file has no usable render. "Same file"
// is load-bearing — reusing a render across a file switch would show the reader
// the wrong document.

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFile } from '../../src/types';

const inlineState = vi.hoisted(() => ({
  pending: [] as Array<{ resolve: (html: string) => void; reject: (err: unknown) => void }>,
  calls: 0,
}));

vi.mock('../../src/components/file-viewer-preview-assets', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../src/components/file-viewer-preview-assets')
  >();
  return {
    ...actual,
    inlineRelativeAssets: vi.fn(
      () =>
        new Promise<string>((resolve, reject) => {
          inlineState.calls += 1;
          inlineState.pending.push({ resolve, reject });
        }),
    ),
  };
});

import { FileViewer } from '../../src/components/FileViewer';

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

function stubFetch(html: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.startsWith(RAW_URL_PREFIX)) return new Response(html, { status: 200 });
      if (url === ANOMALY_ENDPOINT) return new Response('{"ok":true}', { status: 200 });
      return new Response('', { status: 404 });
    }),
  );
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

describe('an inlining budget that expires keeps the render already on screen', () => {
  it('holds the last inlined render for the same file when a re-inline overruns', async () => {
    stubFetch(rawHtml('Styled'));

    const { rerender } = render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />,
    );

    // First pass settles: the reader is looking at a styled page.
    await waitFor(() => expect(inlineState.calls).toBe(1));
    await settleNextInline(inlinedHtml('Styled'));
    await waitFor(() => expect(frameSrcDoc()).toContain(INLINE_MARKER));

    // An agent write lands. Track 2.3's coalesced refresh resets the project
    // file set, which restarts the inlining pass for the same file.
    const callsBeforeRefresh = inlineState.calls;
    rerender(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlFile()}
        filesRefreshKey={1}
      />,
    );
    await waitFor(() => expect(inlineState.calls).toBeGreaterThan(callsBeforeRefresh));

    // The revalidation never settles and runs past its budget.
    await advance(16_000);

    // Stale-while-revalidate had usable content, so the timeout must not
    // downgrade it: the styled render stays, and the warning explains why the
    // page may be out of date.
    expect(frameSrcDoc()).toContain(INLINE_MARKER);
    expect(frameSrcDoc()).toContain('Styled');
    const warning = screen.getByTestId('preview-inline-timeout-warning');
    expect(warning).toHaveAttribute('role', 'alert');
    expect(warning.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it('still shows raw source when this file has no render to keep', async () => {
    // A first open has nothing retained, so the budget still has to hand over
    // the document itself rather than hold a gate that never lifts.
    stubFetch(rawHtml('FirstOpen'));

    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />);

    await waitFor(() => expect(inlineState.calls).toBe(1));
    expect(previewFrame()).toBeNull();

    await advance(16_000);

    await waitFor(() => expect(previewFrame()).not.toBeNull());
    expect(frameSrcDoc()).toContain('FirstOpen');
    expect(frameSrcDoc()).not.toContain(INLINE_MARKER);
    expect(screen.getByTestId('preview-inline-timeout-warning')).toBeTruthy();
  });

  it('never carries a retained render across a file switch', async () => {
    stubFetch(rawHtml('Shared'));

    const { rerender } = render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile('first.html')} />,
    );

    await waitFor(() => expect(inlineState.calls).toBe(1));
    await settleNextInline(inlinedHtml('FirstFile'));
    await waitFor(() => expect(frameSrcDoc()).toContain('FirstFile'));

    // A different file, whose own pass never settles. The retained render
    // belongs to the previous file and must not be shown under this one.
    const callsBeforeSwitch = inlineState.calls;
    rerender(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile('second.html')} />,
    );
    await waitFor(() => expect(inlineState.calls).toBeGreaterThan(callsBeforeSwitch));

    await advance(16_000);

    expect(frameSrcDoc()).not.toContain('FirstFile');
    expect(frameSrcDoc()).not.toContain(INLINE_MARKER);
    expect(frameSrcDoc()).toContain('Shared');
  });
});
