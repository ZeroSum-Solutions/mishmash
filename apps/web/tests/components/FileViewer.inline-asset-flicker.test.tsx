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
//
// R5 regression matrix (per the F004 PRD's definition of "update"): each
// distinct trigger shape gets its own assertion below — fresh mount, an
// in-place source change (agent edit / Manual Edit patch / undo / redo /
// conflict-resync / Reload / version restore), a cross-file switch, and a
// URL-load <-> srcDoc mode transition. A single generic "no flicker" test is
// not enough coverage for shapes with materially different state
// transitions (pre-land audit finding).

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { ProjectFile } from '../../src/types';
import type { ManualEditTarget } from '../../src/edit-mode/types';
import { emptyManualEditStyles } from '../../src/edit-mode/types';

// Deferred, identity-keyed control over inlineRelativeAssets. Keyed by the
// `source` string each call was made with (not call order), so a test can
// resolve calls out of submission order — required to prove a stale (older)
// generation's completion is ignored when it settles AFTER a newer one
// (R5: out-of-order completion is a named required case, not an assumption).
const inlineState = vi.hoisted(() => ({
  pending: [] as Array<{
    source: string;
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
      (source: string) =>
        new Promise<string>((resolve, reject) => {
          inlineState.calls += 1;
          inlineState.pending.push({ source, resolve, reject });
        }),
    ),
  };
});

// Manual Edit tests drive real onApplyPatch/onUndo/onRedo callbacks, the same
// way FileViewer.manual-edit-history.test.tsx does, by capturing the props
// FileViewer passes to ManualEditPanel instead of round-tripping through the
// panel's own UI (which is not the surface under test here).
const panelState = vi.hoisted(() => ({
  props: null as ComponentProps<typeof import('../../src/components/ManualEditPanel').ManualEditPanel> | null,
}));

vi.mock('../../src/components/ManualEditPanel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/components/ManualEditPanel')>();
  return {
    ...actual,
    ManualEditPanel: (props: ComponentProps<typeof actual.ManualEditPanel>) => {
      panelState.props = props;
      return <div data-testid="mock-manual-edit-panel" />;
    },
  };
});

import { FileViewer } from '../../src/components/FileViewer';

afterEach(() => {
  cleanup();
  inlineState.pending = [];
  inlineState.calls = 0;
  panelState.props = null;
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

function heroTarget(): ManualEditTarget {
  return {
    id: 'hero',
    kind: 'text',
    label: 'Hero',
    tagName: 'h1',
    className: '',
    text: 'Hero',
    rect: { x: 0, y: 0, width: 120, height: 40 },
    fields: { text: 'Hero' },
    attributes: { 'data-od-id': 'hero' },
    styles: emptyManualEditStyles(),
    isLayoutContainer: false,
    outerHtml: '<h1 data-od-id="hero">Hero</h1>',
  };
}

async function selectManualEditTarget(target = heroTarget()) {
  const frame = await waitFor(() => {
    const node = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    if (!node.contentWindow) throw new Error('Preview frame not ready');
    return node;
  });
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'od-edit-select', target },
      source: frame.contentWindow,
    }));
  });
  await waitFor(() => expect(panelState.props).not.toBeNull());
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

function inlinedHtmlWithAssetTag(label: string, assetTag: string): string {
  return `<html><head><style ${INLINE_MARKER}="styles.css">/* ${assetTag} */ h1{color:red}</style></head><body><h1>${label}</h1>${SECTIONS}</body></html>`;
}

// No forcing signal (fewer than 5 sections, no external script) — these stay
// on the URL-load path by default. Used only by the URL-load <-> srcDoc
// transition test, which needs a fixture that is NOT permanently pinned to
// srcDoc the way the rest of this file's fixtures are.
function rawHtmlUrlLoadEligible(label: string): string {
  return `<html><head><link rel="stylesheet" href="styles.css"></head><body><h1>${label}</h1></body></html>`;
}

function inlinedHtmlUrlLoadEligible(label: string): string {
  return `<html><head><style ${INLINE_MARKER}="styles.css">h1{color:red}</style></head><body><h1>${label}</h1></body></html>`;
}

function rawHtmlHero(label: string): string {
  return `<html><head><link rel="stylesheet" href="styles.css"></head><body><h1 data-od-id="hero" style="color:#111111">${label}</h1></body></html>`;
}

function inlinedHtmlHero(label: string): string {
  return `<html><head><style ${INLINE_MARKER}="styles.css">h1{color:red}</style></head><body><h1 data-od-id="hero" style="color:#111111">${label}</h1></body></html>`;
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

// Resolves a specific pending call by matching a substring of the `source` it
// was invoked with, regardless of submission order.
async function settleInlineMatching(sourceSubstring: string, outcome: { html?: string; error?: unknown }) {
  const index = inlineState.pending.findIndex((entry) => entry.source.includes(sourceSubstring));
  if (index === -1) throw new Error(`no pending inlineRelativeAssets call matching "${sourceSubstring}"`);
  const next = inlineState.pending.splice(index, 1)[0];
  if (!next) throw new Error(`no pending inlineRelativeAssets call matching "${sourceSubstring}"`);
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

  it('drops the retained inline when an edit removes the last asset ref', async () => {
    // The retention key is the file, not the content, so a source change that
    // no longer needs rewriting has nothing coming to replace what is held.
    // Without an explicit clear the previous document stays on screen for
    // good — there is no later event that corrects it.
    vi.stubGlobal('fetch', fetchReturning(rawHtml('With refs')));
    const { rerender } = render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />,
    );

    await waitFor(() => expect(inlineState.calls).toBe(1));
    await settleNextInline({ html: inlinedHtml('With refs') });
    await waitFor(() => expect(frameSrcDoc()).toContain('With refs'));

    const noRefs = `<html><head></head><body><h1>No refs now</h1>${SECTIONS}</body></html>`;
    vi.stubGlobal('fetch', fetchReturning(noRefs));
    await act(async () => {
      rerender(
        <FileViewer
          projectId="project-1"
          projectKind="prototype"
          file={{ ...htmlFile(), mtime: 1710009999 }}
        />,
      );
    });

    await waitFor(() => expect(frameSrcDoc()).toContain('No refs now'));
    expect(frameSrcDoc()).not.toContain('With refs');
    expect(frameSrcDoc()).not.toContain(INLINE_MARKER);
  });

  it('holds the last good render while a root-relative edit waits on the file list, then corrects', async () => {
    // Review flagged this branch as a second staleness hole. It is not: unlike
    // the no-refs branch, a rewrite IS coming — it is waiting on a file-list
    // fetch that always resolves. Clearing here would flash the loading gate
    // on every save, because the file list resets whenever mtime changes.
    // What matters is that it self-corrects, so that is what this pins.
    vi.stubGlobal('fetch', fetchReturning(rawHtml('Before edit')));
    const { rerender } = render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />,
    );

    await waitFor(() => expect(inlineState.calls).toBe(1));
    await settleNextInline({ html: inlinedHtml('Before edit') });
    await waitFor(() => expect(frameSrcDoc()).toContain('Before edit'));

    const rootRelative =
      `<html><head></head><body><h1>After edit</h1><img src="/logo.png">${SECTIONS}</body></html>`;
    vi.stubGlobal('fetch', fetchReturning(rootRelative));
    await act(async () => {
      rerender(
        <FileViewer
          projectId="project-1"
          projectKind="prototype"
          file={{ ...htmlFile(), mtime: 1710007777 }}
        />,
      );
    });

    // It corrects on its own once the rewrite lands — no stuck document.
    while (inlineState.pending.length > 0) {
      await settleNextInline({ html: inlinedHtml('After edit') });
    }
    await waitFor(() => expect(frameSrcDoc()).toContain('After edit'));
    expect(frameSrcDoc()).not.toContain('Before edit');
  });

  it('does not paint a pre-reload rewrite while Manual Edit holds the source frozen', async () => {
    // A guard, not a repro — it passes on `main` too. Review raised the case:
    // Reload skips its own `setSource(null)` while Manual Edit holds a frozen
    // source, so a rewrite of the pre-reload document could in principle be
    // read as the current one after the freeze lifts. It cannot, because the
    // effect's cleanup cancels the stale rewrite before it can write. This
    // pins that, so a future change that drops the cancel is caught.
    vi.stubGlobal('fetch', fetchReturning(rawHtml('Before reload')));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />);

    await waitFor(() => expect(inlineState.calls).toBe(1));
    await settleNextInline({ html: inlinedHtml('Before reload') });
    await waitFor(() => expect(frameSrcDoc()).toContain('Before reload'));

    // Enter Manual Edit: this is what makes Reload keep `source` rather than
    // nulling it.
    await act(async () => {
      screen.getByTestId('manual-edit-mode-toggle').click();
    });

    vi.stubGlobal('fetch', fetchReturning(rawHtml('After reload')));
    await act(async () => {
      screen.getByRole('button', { name: /reload preview/i }).click();
    });
    await waitFor(() => expect(inlineState.calls).toBeGreaterThanOrEqual(2));

    // Settle the stale generation's rewrite. It must not become the retained
    // value for the current one.
    await settleNextInline({ html: inlinedHtml('Before reload') });

    // Leaving Manual Edit drops the freeze and the preview goes back to
    // reading the retained inline. The stale generation's rewrite must not be
    // what it reads.
    await act(async () => {
      screen.getByTestId('manual-edit-mode-toggle').click();
    });
    // Definite state, not a string comparison against a missing frame: the
    // post-reload rewrite is still pending, so the gate is up and there is no
    // frame at all. The stale document is therefore provably not on screen.
    await waitFor(() => expect(previewFrame()).toBeNull());

    while (inlineState.pending.length > 0) {
      await settleNextInline({ html: inlinedHtml('After reload') });
    }
    await waitFor(() => expect(frameSrcDoc()).toContain('After reload'));
  });

  // --- R5 matrix additions below (pre-land audit F004 defects 1 & 3) ---

  it('does not stay pinned to a stale retained inline across a URL-load -> srcDoc mode transition', async () => {
    // Under the composition-metrics/section threshold and with no forcing
    // script, so the preview defaults to URL-load — the inlining effect's own
    // early return (`if (useUrlLoadPreview) return;`) never runs while this
    // mode is active, and never clears what it retained from a PRIOR srcDoc
    // visit either.
    vi.stubGlobal('fetch', fetchReturning(rawHtmlUrlLoadEligible('First')));
    const { rerender } = render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />,
    );

    await waitFor(() => expect(screen.getByTestId('artifact-preview-frame')).toBeTruthy());
    expect(inlineState.calls).toBe(0);

    // Enter Inspect: forces srcDoc regardless of content shape, so the
    // inlining effect fires for the first time.
    fireEvent.click(screen.getByTestId('inspect-mode-toggle'));
    await waitFor(() => expect(inlineState.calls).toBe(1));
    // Nothing retained yet for this key -- the pre-existing loading gate (R2)
    // holds the frame back rather than painting raw.
    expect(previewFrame()).toBeNull();

    await settleNextInline({ html: inlinedHtmlUrlLoadEligible('First') });
    await waitFor(() => expect(frameSrcDoc()).toContain(INLINE_MARKER));
    expect(frameSrcDoc()).toContain('First');

    // Exit Inspect: back to URL-load. The retained inline is left in place,
    // untouched, per the effect's early return.
    fireEvent.click(screen.getByTestId('inspect-mode-toggle'));

    // An agent edit lands while URL-loaded -- the retained inline above is now
    // stale for the new source, but nothing clears or refreshes it, because
    // the inlining effect never runs while `useUrlLoadPreview` is true.
    vi.stubGlobal('fetch', fetchReturning(rawHtmlUrlLoadEligible('Second')));
    await act(async () => {
      rerender(
        <FileViewer
          projectId="project-1"
          projectKind="prototype"
          file={{ ...htmlFile(), mtime: 1710000999 }}
        />,
      );
    });
    await waitFor(() => expect(screen.getByTestId('artifact-preview-frame')).toBeTruthy());
    expect(inlineState.calls).toBe(1); // still just the one call -- URL-load skipped it

    // Re-enter Inspect. The retained inline is non-null (stale "First"), so
    // the R2 loading gate does not engage this time -- this is exactly the
    // freeze-capture race the finding is about.
    fireEvent.click(screen.getByTestId('inspect-mode-toggle'));
    await waitFor(() => expect(inlineState.calls).toBe(2));
    // Self-correcting, not raw, while the fresh rewrite is pending.
    expect(previewFrame()).not.toBeNull();
    expect(frameSrcDoc()).toContain(INLINE_MARKER);

    // Once the fresh rewrite for "Second" resolves, the preview must show it
    // -- not stay pinned to the stale "First" snapshot the freeze would have
    // captured without the F004 fix. Under the unfixed freeze-capture
    // effects, `annotationFrozenSource` locks onto "First" as soon as Inspect
    // re-opens and never looks again, so this assertion times out on
    // unfixed code.
    await settleNextInline({ html: inlinedHtmlUrlLoadEligible('Second') });
    await waitFor(() => expect(frameSrcDoc()).toContain('Second'));
    expect(frameSrcDoc()).toContain(INLINE_MARKER);
    expect(frameSrcDoc()).not.toContain('First');
  });

  it('ignores a stale inline resolving after a newer one, even when it settles later (out-of-order completion)', async () => {
    vi.stubGlobal('fetch', fetchReturning(rawHtml('First')));
    const { rerender } = render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />,
    );

    await waitFor(() => expect(inlineState.calls).toBeGreaterThanOrEqual(1));
    // Do NOT resolve gen 1 yet — a second source change lands before it does.
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
    // The effect can legitimately re-run more than once per generation (its
    // deps also include the project file-path set, refreshed independently on
    // every mtime bump), so assert on identity, not a raw call count: at
    // least one "Second" request must be pending, alongside the still-
    // unresolved "First" one(s).
    await waitFor(() =>
      expect(inlineState.pending.some((entry) => entry.source.includes('Second'))).toBe(true),
    );
    expect(inlineState.pending.some((entry) => entry.source.includes('First'))).toBe(true);

    // Resolve every pending "Second" (newer-generation) request first — it
    // should win, however many duplicate requests it produced.
    while (inlineState.pending.some((entry) => entry.source.includes('Second'))) {
      await settleInlineMatching('Second', { html: inlinedHtml('Second') });
    }
    await waitFor(() => expect(frameSrcDoc()).toContain('Second'));
    expect(frameSrcDoc()).toContain(INLINE_MARKER);

    // Every stale "First" request finally settles, out of order (after the
    // newer generation already resolved and painted). Each must be ignored —
    // the effect's own cleanup sets `cancelled` for that generation once a
    // later effect run started, and the `.then`/`.catch` handlers check it
    // before calling `setInlinedSource`.
    while (inlineState.pending.some((entry) => entry.source.includes('First'))) {
      await settleInlineMatching('First', { html: inlinedHtml('First') });
    }
    expect(frameSrcDoc()).toContain('Second');
    expect(frameSrcDoc()).not.toContain('First');
    expect(frameSrcDoc()).toContain(INLINE_MARKER);
  });

  it('re-inlines on Reload even when the top-level HTML bytes are unchanged but a dependent asset changed', async () => {
    // R4 in the original PRD draft ("skip rebuilding when reloadKey changes
    // but bytes are identical") was dropped for exactly this reason:
    // identical top-level HTML does not imply identical styles.css/site.js/
    // image bytes. Reload must always force a fresh inline pass.
    const unchanged = rawHtml('Unchanged');
    vi.stubGlobal('fetch', fetchReturning(unchanged));
    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />);

    await waitFor(() => expect(inlineState.calls).toBe(1));
    await settleNextInline({ html: inlinedHtml('Unchanged') });
    await waitFor(() => expect(frameSrcDoc()).toContain(INLINE_MARKER));

    // Reload: the raw HTML served is byte-for-byte identical to before. A
    // dependent asset (styles.css) is presumed to have changed on disk,
    // represented here by resolving the next inline pass with different
    // inlined content.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reload preview/i }));
    });

    await waitFor(() => expect(inlineState.calls).toBe(2));
    while (inlineState.pending.length > 0) {
      await settleNextInline({ html: inlinedHtmlWithAssetTag('Unchanged', 'asset-v2') });
    }
    await waitFor(() => expect(frameSrcDoc()).toContain('asset-v2'));
    expect(frameSrcDoc()).toContain(INLINE_MARKER);
  });

  it('keeps a Manual Edit style patch invisible to the frozen srcDoc while it re-inlines in the background', async () => {
    let persistedSource = rawHtmlHero('Hero');
    const savedSources: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/deployments')) {
        return new Response(JSON.stringify({ deployments: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)) as { content: string };
        persistedSource = payload.content;
        savedSources.push(payload.content);
        return new Response(JSON.stringify({ file: htmlFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith(RAW_URL_PREFIX)) {
        return new Response(persistedSource, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />);

    // Manual Edit forces srcDoc unconditionally, so entering it is what
    // starts the first inline pass here.
    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await waitFor(() => expect(inlineState.calls).toBe(1));
    await settleNextInline({ html: inlinedHtmlHero('Hero') });
    await waitFor(() => expect(frameSrcDoc()).toContain(INLINE_MARKER));

    await selectManualEditTarget();
    const beforePatchSrcDoc = frameSrcDoc();

    // Style patches route live style updates through postMessage instead of
    // reloading the iframe — but `source` still changes underneath (Path A),
    // so a background re-inline still fires. It must stay invisible to the
    // frozen preview.
    act(() => {
      panelState.props?.onApplyPatch(
        { kind: 'set-style', id: 'hero', styles: { color: '#ef4444' } },
        'Style: Hero',
      );
    });
    await waitFor(() => expect(savedSources).toHaveLength(1));
    await waitFor(() => expect(inlineState.calls).toBe(2));

    // Still frozen at the pre-patch render — no visible change at all.
    expect(frameSrcDoc()).toBe(beforePatchSrcDoc);

    await settleNextInline({ html: inlinedHtmlHero('Hero') });

    // Resolving the background pass must not disturb the frozen preview
    // either, and it must never have shown raw content along the way.
    expect(frameSrcDoc()).toBe(beforePatchSrcDoc);
    expect(frameSrcDoc()).toContain(INLINE_MARKER);
  });

  it('never paints raw content across a Manual Edit non-style patch, undo, and an external-conflict resync', async () => {
    let persistedSource = rawHtmlHero('Hero');
    const savedSources: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('/api/projects/project-1/deployments')) {
        return new Response(JSON.stringify({ deployments: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/projects/project-1/files') && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)) as { content: string };
        persistedSource = payload.content;
        savedSources.push(payload.content);
        return new Response(JSON.stringify({ file: htmlFile() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.startsWith(RAW_URL_PREFIX)) {
        return new Response(persistedSource, { status: 200 });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />);

    fireEvent.click(screen.getByTestId('manual-edit-mode-toggle'));
    await waitFor(() => expect(inlineState.calls).toBe(1));
    await settleNextInline({ html: inlinedHtmlHero('Hero') });
    await waitFor(() => expect(frameSrcDoc()).toContain(INLINE_MARKER));
    await selectManualEditTarget();

    // A non-style patch (set-text): this is the one that used to freeze
    // straight onto the RAW patched source (applyManualEditPatch only
    // transforms the source string; it never inlines). While the fresh
    // inline pass for it is pending, the frozen srcDoc must fall back to the
    // last known-good inlined render — never raw.
    act(() => {
      panelState.props?.onApplyPatch({ id: 'hero', kind: 'set-text', value: 'Edited' }, 'Content: Hero');
    });
    await waitFor(() => expect(savedSources).toHaveLength(1));
    await waitFor(() => expect(inlineState.calls).toBe(2));
    expect(frameSrcDoc()).toContain(INLINE_MARKER);

    await settleNextInline({ html: inlinedHtmlHero('Edited') });
    await waitFor(() => expect(frameSrcDoc()).toContain('Edited'));
    expect(frameSrcDoc()).toContain(INLINE_MARKER);

    // Undo: reverts to the pre-patch source. Same invariant — never raw,
    // even transiently while its own fresh inline pass is pending.
    act(() => {
      panelState.props?.onUndo();
    });
    await waitFor(() => expect(savedSources).toHaveLength(2));
    await waitFor(() => expect(inlineState.calls).toBe(3));
    expect(frameSrcDoc()).toContain(INLINE_MARKER);

    await settleNextInline({ html: inlinedHtmlHero('Hero') });
    await waitFor(() => expect(frameSrcDoc()).toContain('Hero'));
    expect(frameSrcDoc()).not.toContain('Edited');
    expect(frameSrcDoc()).toContain(INLINE_MARKER);

    // External conflict-resync: something wrote the file outside Manual Edit
    // (an agent run) between the undo save above and a follow-up redo/patch
    // attempt. confirmManualEditHistorySource detects the mismatch, resyncs
    // `source` to what is actually persisted, and clears history — without
    // ever routing the frozen preview through raw content.
    const savedBeforeConflict = savedSources.length;
    persistedSource = rawHtmlHero('Agent overwrote this');
    act(() => {
      panelState.props?.onApplyPatch({ id: 'hero', kind: 'set-text', value: 'Should not apply' }, 'Content: Hero');
    });
    await waitFor(() => expect(inlineState.calls).toBeGreaterThanOrEqual(4));
    // The conflicted patch must not have been saved: confirmManualEditHistorySource
    // short-circuits before the write.
    expect(savedSources).toHaveLength(savedBeforeConflict);
    // The canvas stays on its last known-good frozen render throughout —
    // never raw, and never the rejected "Should not apply" text.
    expect(frameSrcDoc()).toContain(INLINE_MARKER);
    expect(frameSrcDoc()).not.toContain('Should not apply');

    while (inlineState.pending.length > 0) {
      await settleNextInline({ html: inlinedHtmlHero('Agent overwrote this') });
    }
    expect(frameSrcDoc()).toContain(INLINE_MARKER);
  });

  it('re-inlines a restored version and never paints it raw', async () => {
    const current = rawHtml('Current');
    const oldDraft = rawHtml('OldDraft');
    const oldVersion = {
      id: 'v-old',
      fileName: 'preview.html',
      version: 1,
      label: 'Old draft',
      createdAt: 1700000000000,
      source: 'ai' as const,
      prompt: null,
      size: oldDraft.length,
      mime: 'text/html',
      kind: 'html' as const,
      current: false,
    };
    const currentVersion = {
      ...oldVersion,
      id: 'v-current',
      version: 2,
      label: 'Current',
      current: true,
    };

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url === '/api/projects/project-1/files/preview.html/versions') {
        return new Response(
          JSON.stringify({ file: htmlFile(), versions: [currentVersion, oldVersion] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/projects/project-1/files/preview.html/versions/v-old') {
        return new Response(
          JSON.stringify({ version: oldVersion, content: oldDraft }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url === '/api/projects/project-1/files/preview.html/versions/v-old/restore' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ file: htmlFile(), version: { ...oldVersion, current: true } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.startsWith(RAW_URL_PREFIX)) return new Response(current, { status: 200 });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} />);

    await waitFor(() => expect(inlineState.calls).toBe(1));
    await settleNextInline({ html: inlinedHtml('Current') });
    await waitFor(() => expect(frameSrcDoc()).toContain('Current'));

    fireEvent.click(screen.getByRole('button', { name: 'Versions' }));
    const oldOption = await screen.findByRole('option', { name: /Old draft/i });
    fireEvent.click(oldOption);

    const restoreButton = await screen.findByRole('button', { name: /switch to this version/i });
    await waitFor(() => expect(restoreButton).not.toBeDisabled());
    fireEvent.click(restoreButton);
    fireEvent.click(await screen.findByRole('button', { name: /^switch$/i }));

    // handleVersionRestored calls setSource(oldDraft) — a Path A source
    // change — which starts a fresh inline pass. Until it resolves, the
    // canvas must keep showing the last known-good render, never raw.
    await waitFor(() => expect(inlineState.calls).toBe(2));
    expect(frameSrcDoc()).toContain(INLINE_MARKER);

    while (inlineState.pending.length > 0) {
      await settleNextInline({ html: inlinedHtml('OldDraft') });
    }
    await waitFor(() => expect(frameSrcDoc()).toContain('OldDraft'));
    expect(frameSrcDoc()).toContain(INLINE_MARKER);
  });
});
