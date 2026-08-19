// @vitest-environment jsdom
// F004 — the canvas painted every asset-inlined preview twice.
//
// `inlineRelativeAssets` rewrites a document's relative <link>/<script>/<img>
// refs into inline content, and it is async. The effect that drove it cleared
// `inlinedSource` unconditionally on entry, so between the clear and the
// resolve the preview fell back to the RAW document — a fully formed, visibly
// unstyled render — and then swapped to the inlined one. Two paints per open,
// two per source change.
//
// The fix keys the retained inline to `projectId:file.name`, drops the
// unconditional clear, and holds the existing loading gate up while a rewrite
// is pending. These tests pin both halves: the raw document is never painted,
// and a failed rewrite still releases the gate instead of hanging.

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFile } from '../../src/types';

// Deferred control over inlineRelativeAssets, at that boundary rather than at
// `fetch`, so a test does not have to fake a response per asset URL.
const inlineState = vi.hoisted(() => ({
  pending: [] as Array<{
    resolve: (html: string) => void;
    reject: (err: unknown) => void;
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
      () =>
        new Promise<string>((resolve, reject) => {
          inlineState.calls += 1;
          inlineState.pending.push({ resolve, reject });
        }),
    ),
  };
});

import { FileViewer } from '../../src/components/FileViewer';

afterEach(() => {
  cleanup();
  inlineState.pending = [];
  inlineState.calls = 0;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const RAW_URL_PREFIX = '/api/projects/project-1/raw/';
const INLINE_MARKER = 'data-od-inline-asset';

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

// Five <section> elements clear COMPOSITION_METRICS_SECTION_THRESHOLD, which
// disqualifies the URL-load path and forces srcDoc — the only mode that
// inlines assets at all. The relative stylesheet ref is what makes
// hasRelativeAssetRefs() true so the effect reaches inlineRelativeAssets.
const SECTIONS = '<section>1</section><section>2</section><section>3</section>' +
  '<section>4</section><section>5</section>';

function rawHtml(label: string): string {
  return `<html><head><link rel="stylesheet" href="styles.css"></head><body><h1>${label}</h1>${SECTIONS}</body></html>`;
}

function inlinedHtml(label: string): string {
  return `<html><head><style ${INLINE_MARKER}="styles.css">h1{color:red}</style></head><body><h1>${label}</h1>${SECTIONS}</body></html>`;
}

function fetchReturning(html: string) {
  return vi.fn(async (input: string | URL | Request) => {
    const url =
      typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    if (url.startsWith(RAW_URL_PREFIX)) return new Response(html, { status: 200 });
    return new Response('', { status: 404 });
  });
}

function previewFrame(): HTMLIFrameElement | null {
  return screen.queryByTestId('artifact-preview-frame') as HTMLIFrameElement | null;
}

function frameSrcDoc(): string {
  return previewFrame()?.getAttribute('srcDoc') ?? '';
}

async function settleNextInline(outcome: { html?: string; error?: unknown }) {
  const next = inlineState.pending.shift();
  if (!next) throw new Error('no pending inlineRelativeAssets call');
  await act(async () => {
    if (outcome.error !== undefined) next.reject(outcome.error);
    else next.resolve(outcome.html ?? '');
  });
}

describe('FileViewer — asset inlining never paints the raw document first', () => {
  it('holds the loading gate on a fresh mount instead of rendering the un-inlined source', async () => {
    vi.stubGlobal('fetch', fetchReturning(rawHtml('Hello')));

    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />);

    // The rewrite is pending: the accessible loader is up and there is no
    // preview frame at all, so the raw document cannot have been painted.
    await waitFor(() => expect(inlineState.calls).toBe(1));
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(previewFrame()).toBeNull();

    await settleNextInline({ html: inlinedHtml('Hello') });

    await waitFor(() => expect(frameSrcDoc()).toContain(INLINE_MARKER));
    expect(frameSrcDoc()).toContain('Hello');
  });

  it('keeps showing the previous inlined document while a source change is being re-inlined', async () => {
    vi.stubGlobal('fetch', fetchReturning(rawHtml('First')));
    const { rerender } = render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />,
    );

    await waitFor(() => expect(inlineState.calls).toBe(1));
    await settleNextInline({ html: inlinedHtml('First') });
    await waitFor(() => expect(frameSrcDoc()).toContain(INLINE_MARKER));

    // An agent edit lands: the file's source changes under the same key.
    vi.stubGlobal('fetch', fetchReturning(rawHtml('Second')));
    await act(async () => {
      rerender(
        <FileViewer
          projectId="project-1"
          projectKind="prototype"
          file={{ ...htmlFile(), mtime: 1710000999 }}
        />,
      );
    });
    await waitFor(() => expect(inlineState.calls).toBeGreaterThanOrEqual(2));

    // The window where the bug used to show: the raw "Second" document must
    // never be on screen. The previous inlined render holds until the new one
    // resolves.
    expect(frameSrcDoc()).toContain(INLINE_MARKER);
    expect(frameSrcDoc()).not.toContain('Second');

    while (inlineState.pending.length > 0) {
      await settleNextInline({ html: inlinedHtml('Second') });
    }
    await waitFor(() => expect(frameSrcDoc()).toContain('Second'));
    expect(frameSrcDoc()).toContain(INLINE_MARKER);
  });

  it('releases the loading gate with the raw document when inlining fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchReturning(rawHtml('Fallback')));

    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />);

    await waitFor(() => expect(inlineState.calls).toBe(1));
    expect(previewFrame()).toBeNull();

    await settleNextInline({ error: new Error('asset fetch exploded') });

    // Unstyled but visible beats a frame that never resolves.
    await waitFor(() => expect(previewFrame()).not.toBeNull());
    expect(frameSrcDoc()).toContain('Fallback');
    expect(frameSrcDoc()).not.toContain(INLINE_MARKER);
    expect(consoleError).toHaveBeenCalled();
  });

  it('does not read a retained inline under a different file', async () => {
    // A guard, not a repro: `main` clears the retained value on every effect
    // run, so it cannot leak either. This pins the property the key gating is
    // there to provide, so removing the key would be caught.
    vi.stubGlobal('fetch', fetchReturning(rawHtml('File A')));
    const { rerender } = render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile('a.html')} />,
    );

    await waitFor(() => expect(inlineState.calls).toBe(1));
    await settleNextInline({ html: inlinedHtml('File A') });
    await waitFor(() => expect(frameSrcDoc()).toContain('File A'));
    expect(previewFrame()).not.toBeNull();

    vi.stubGlobal('fetch', fetchReturning(rawHtml('File B')));
    await act(async () => {
      rerender(
        <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile('b.html')} />,
      );
    });

    // File B's own rewrite is pending, so the gate is up. The definite
    // assertion is that there is no frame at all — not merely that a missing
    // frame yields no matching string.
    await waitFor(() => expect(previewFrame()).toBeNull());

    while (inlineState.pending.length > 0) {
      await settleNextInline({ html: inlinedHtml('File B') });
    }

    // And once B resolves, B is what is on screen — A's body never appears
    // under B's chrome.
    await waitFor(() => expect(previewFrame()).not.toBeNull());
    expect(frameSrcDoc()).toContain('File B');
    expect(frameSrcDoc()).not.toContain('File A');
  });

  it('does not paint a rewrite that was already in flight when Reload was pressed', async () => {
    // Reload skips its own `setSource(null)` while Manual Edit holds a frozen
    // source, so the retention key carries `reloadKey` as well: a rewrite
    // belonging to the generation before the Reload must never be read as the
    // current one, whichever way the effect unwound.
    vi.stubGlobal('fetch', fetchReturning(rawHtml('Before reload')));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />);

    // Leave the first rewrite in flight — this is the one that must not land.
    await waitFor(() => expect(inlineState.calls).toBe(1));
    expect(previewFrame()).toBeNull();

    vi.stubGlobal('fetch', fetchReturning(rawHtml('After reload')));
    await act(async () => {
      screen.getByRole('button', { name: /reload preview/i }).click();
    });
    await waitFor(() => expect(inlineState.calls).toBeGreaterThanOrEqual(2));

    // Settle the stale one first. It carries the pre-reload document and must
    // change nothing on screen.
    await settleNextInline({ html: inlinedHtml('Before reload') });
    expect(frameSrcDoc()).not.toContain('Before reload');

    while (inlineState.pending.length > 0) {
      await settleNextInline({ html: inlinedHtml('After reload') });
    }
    await waitFor(() => expect(frameSrcDoc()).toContain('After reload'));
  });
});
