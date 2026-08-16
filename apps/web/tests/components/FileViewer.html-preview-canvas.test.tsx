// @vitest-environment jsdom
//
// Coverage for the HTML live-preview canvas (`HtmlViewer` in FileViewer.tsx) —
// feature id `html-live-preview-canvas`. The render-mode *decision* function
// (`shouldUrlLoadHtmlPreview` + its helpers) is already covered end-to-end by
// file-viewer-render-mode.test.ts (62 specs); this file targets what HtmlViewer
// does WITH that decision: the safe-inline text-limit gate, the blocked-asset
// security detector, the powered-preview capability strings, the asset
// preflight limit boundary, and the forceInline query-param wiring.

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FileViewer,
  HTML_PREVIEW_ASSET_PREFLIGHT_LIMIT,
  isBlockedPreviewAssetResponse,
  previewTextNeedsFullSourceForSafeInline,
} from '../../src/components/FileViewer';
import type { ProjectFile } from '../../src/types';
import { __resetPreviewIsolationCache } from '../../src/runtime/powered-preview';

// Hardcoded literals (NOT imported from FileViewer.tsx) so this test pins the
// actual capability strings production ships. Importing POWERED_PREVIEW_SANDBOX
// / POWERED_PREVIEW_ALLOW and comparing the DOM attribute against the same
// binding would prove only that the JSX wiring reads the constant — a
// silently dropped token (e.g. losing `allow-same-origin`) would move both
// sides of the assertion together and the test would still pass.
const EXPECTED_POWERED_PREVIEW_SANDBOX =
  'allow-scripts allow-same-origin allow-downloads allow-popups allow-forms allow-modals allow-pointer-lock';
const EXPECTED_POWERED_PREVIEW_ALLOW =
  'accelerometer; autoplay; camera; cross-origin-isolated; fullscreen; gamepad; gyroscope; microphone; xr-spatial-tracking';

afterEach(() => {
  cleanup();
  __resetPreviewIsolationCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

function htmlFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    name: 'preview.html',
    path: 'preview.html',
    type: 'file',
    size: 1024,
    mtime: 1710000000,
    kind: 'html',
    mime: 'text/html',
    artifactManifest: {
      version: 1,
      kind: 'html',
      title: 'Preview',
      entry: 'preview.html',
      renderer: 'html',
      exports: ['html'],
    },
    ...overrides,
  };
}

// Catch-all fetch stub: routes the two calls every HtmlViewer mount makes
// unconditionally (project file list, deployments) to empty success
// responses, and 404s anything else unless a caller-supplied `handlers`
// entry matches first. Mirrors the pattern already used by the raw-route
// security test in FileViewer.test.tsx.
function stubPreviewFetch(handlers: Array<[match: string, response: () => Response]> = []) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    for (const [match, respond] of handlers) {
      if (url.includes(match)) return respond();
    }
    if (url.includes('/files')) {
      return new Response(JSON.stringify({ files: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/deployments')) {
      return new Response(JSON.stringify({ deployments: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
}

describe('previewTextNeedsFullSourceForSafeInline', () => {
  it('is false for null/empty source', () => {
    expect(previewTextNeedsFullSourceForSafeInline(null)).toBe(false);
    expect(previewTextNeedsFullSourceForSafeInline('')).toBe(false);
  });

  it('is false for plain HTML that needs none of the srcDoc-only guards', () => {
    expect(previewTextNeedsFullSourceForSafeInline('<html><body><h1>Just text</h1></body></html>')).toBe(false);
  });

  it('is true when the routing-preview slice shows the tweaks template', () => {
    expect(previewTextNeedsFullSourceForSafeInline('<div class="tw-panel">panel</div>')).toBe(true);
  });

  it('is true when the routing-preview slice needs the sandbox shim (external script)', () => {
    expect(previewTextNeedsFullSourceForSafeInline('<script src="app.js"></script>')).toBe(true);
  });

  it('is true when the routing-preview slice needs the focus guard (autofocus)', () => {
    expect(previewTextNeedsFullSourceForSafeInline('<input autofocus>')).toBe(true);
  });

  it('is true when the routing-preview slice needs the redirect guard (meta refresh)', () => {
    expect(previewTextNeedsFullSourceForSafeInline('<meta http-equiv="refresh" content="0">')).toBe(true);
  });
});

describe('isBlockedPreviewAssetResponse', () => {
  it('matches a plain-string body containing the security message', () => {
    expect(isBlockedPreviewAssetResponse('Error: path escapes project dir via symlink /etc/passwd')).toBe(true);
  });

  it('rejects a plain-string body that does not mention the security message', () => {
    expect(isBlockedPreviewAssetResponse('Not Found')).toBe(false);
  });

  it('matches a JSON body whose `error` field is the message string directly', () => {
    expect(isBlockedPreviewAssetResponse({ error: 'path escapes project dir via symlink /x' })).toBe(true);
  });

  it('matches a JSON body whose `error` is a {code, message} object (daemon BAD_REQUEST shape)', () => {
    expect(
      isBlockedPreviewAssetResponse({
        error: { code: 'BAD_REQUEST', message: 'Error: path escapes project dir via symlink /x' },
      }),
    ).toBe(true);
  });

  it('matches a JSON body carrying the message directly on `message`, with no `error` field', () => {
    expect(isBlockedPreviewAssetResponse({ message: 'path escapes project dir' })).toBe(true);
  });

  it('rejects a {code, message} object whose message does not match, regardless of code', () => {
    expect(
      isBlockedPreviewAssetResponse({ error: { code: 'BAD_REQUEST', message: 'unrelated failure' } }),
    ).toBe(false);
  });

  it('matches a {code, message} object with a matching message even when code is not BAD_REQUEST', () => {
    // Documents the current (permissive) behavior: the code check only ever
    // short-circuits to `true` early — every path falls through to the same
    // unconditional `isBlockedPreviewAssetResponse(detail.message)` check, so
    // the code value never actually gates the match.
    expect(
      isBlockedPreviewAssetResponse({
        error: { code: 'SOME_OTHER_CODE', message: 'path escapes project dir' },
      }),
    ).toBe(true);
  });

  it('rejects non-string, non-object, and empty bodies', () => {
    expect(isBlockedPreviewAssetResponse(null)).toBe(false);
    expect(isBlockedPreviewAssetResponse(undefined)).toBe(false);
    expect(isBlockedPreviewAssetResponse(42)).toBe(false);
    expect(isBlockedPreviewAssetResponse({})).toBe(false);
  });
});

describe('HtmlViewer powered-preview iframe capability strings', () => {
  it('pins the exact sandbox and allow capability lists onto the URL-load iframe when powered preview activates', async () => {
    stubPreviewFetch([
      [
        '/api/preview/isolation',
        () => new Response(JSON.stringify({ supported: true, baseOrigin: 'http://127.0.0.1:43111' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ],
    ]);

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlFile({ name: 'worker.html', path: 'worker.html' })}
        liveHtml="<html><body><script>new SharedArrayBuffer(8)</script></body></html>"
      />,
    );

    await waitFor(() => {
      const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
      expect(frame.getAttribute('data-od-powered')).toBe('true');
    });

    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    // Pinned against a hardcoded literal (see note above) so a silently
    // dropped token (e.g. losing `cross-origin-isolated` from `allow`, or
    // `allow-same-origin` from `sandbox`) fails loudly instead of quietly
    // shrinking what a powered artifact can do.
    expect(frame.getAttribute('sandbox')).toBe(EXPECTED_POWERED_PREVIEW_SANDBOX);
    expect(frame.getAttribute('allow')).toBe(EXPECTED_POWERED_PREVIEW_ALLOW);
  });

  it('does not grant the powered sandbox/allow list to a plain (non-powered) HTML preview', async () => {
    stubPreviewFetch();

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlFile()}
        liveHtml="<html><body><h1>Plain</h1></body></html>"
      />,
    );

    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    expect(frame.getAttribute('data-od-powered')).toBeNull();
    expect(frame.getAttribute('sandbox')).not.toBe(EXPECTED_POWERED_PREVIEW_SANDBOX);
    expect(frame.getAttribute('allow')).toBeNull();
  });
});

describe('HtmlViewer preview-asset preflight limit', () => {
  it('only preflights the first HTML_PREVIEW_ASSET_PREFLIGHT_LIMIT asset refs, so a blocked ref beyond the limit never surfaces a warning', async () => {
    // One more asset ref than the preflight limit allows. Every ref up to
    // (and including) the limit resolves fine; the ref that sits exactly one
    // past the limit is the one that would be blocked by the daemon's raw
    // route — proving it's never even requested is what pins the limit.
    const assetCount = HTML_PREVIEW_ASSET_PREFLIGHT_LIMIT + 1;
    const overLimitAsset = `assets/${HTML_PREVIEW_ASSET_PREFLIGHT_LIMIT}.png`;
    const html = [
      '<html><body>',
      ...Array.from({ length: assetCount }, (_, i) => `<img src="assets/${i}.png" alt="">`),
      '</body></html>',
    ].join('\n');

    const preflightCalls: string[] = [];
    stubPreviewFetch([
      [
        `/raw/${overLimitAsset}`,
        () => new Response(
          JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Error: path escapes project dir via symlink /x' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      ],
      [
        '/raw/assets/',
        () => new Response('', { status: 200 }),
      ],
    ]);
    // Wrap the stub to also record which asset paths were actually checked.
    const baseFetch = window.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      if (url.includes('previewAssetCheck')) preflightCalls.push(url);
      return baseFetch(input as never);
    }));

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlFile()}
        liveHtml={html}
      />,
    );

    // Wait until every in-limit asset has been preflighted. The preflight
    // effect re-runs once the project file list lands (a `projectFilePathSet`
    // dependency), so the exact call count can be a multiple of the limit —
    // what matters is which *distinct* paths were ever requested.
    await waitFor(() => {
      expect(preflightCalls.length).toBeGreaterThanOrEqual(HTML_PREVIEW_ASSET_PREFLIGHT_LIMIT);
    });
    const distinctPreflighted = new Set(
      preflightCalls.map((url) => url.match(/\/raw\/(assets\/\d+\.png)/)?.[1]),
    );
    expect(distinctPreflighted.size).toBe(HTML_PREVIEW_ASSET_PREFLIGHT_LIMIT);

    // The blocked ref sits one past the limit and must never have been
    // requested at all — proving the `.slice(0, LIMIT)` boundary, not just
    // that a warning is absent for an unrelated reason.
    expect(preflightCalls.some((url) => url.includes(overLimitAsset))).toBe(false);
    expect(screen.queryByTestId('preview-asset-warning')).toBeNull();
  });
});

describe('HtmlViewer passive-preview text-fetch size gate', () => {
  // Exercises the raw-fetch (non-liveHtml) preview path: opening a file from
  // disk rather than as agent-authored liveHtml. shouldDeferPassivePreviewSource
  // (FileViewer.tsx ~6991) gates on `file.size > HTML_PASSIVE_PREVIEW_FULL_TEXT_LIMIT`;
  // once deferred, the routing-preview fetch is capped at
  // HTML_ROUTING_TEXT_PREVIEW_LIMIT. Neither constant nor this boundary had any
  // test coverage before this describe block.
  const FULL_TEXT_LIMIT = 2 * 1024 * 1024; // HTML_PASSIVE_PREVIEW_FULL_TEXT_LIMIT
  const ROUTING_PREVIEW_LIMIT = 96 * 1024; // HTML_ROUTING_TEXT_PREVIEW_LIMIT, hardcoded (see below)

  function stubSizeGateFetch(previewText: string) {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      calls.push(url);
      if (url.includes('/files')) {
        return new Response(JSON.stringify({ files: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/deployments')) {
        return new Response(JSON.stringify({ deployments: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/text-preview/')) {
        return new Response(
          JSON.stringify({
            text: previewText,
            truncated: false,
            size: previewText.length,
            limit: ROUTING_PREVIEW_LIMIT,
            mime: 'text/html',
            kind: 'html',
            poweredPreview: { required: false, scannedBytes: 0, complete: true },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/raw/preview.html')) {
        return new Response(previewText, { status: 200, headers: { 'Content-Type': 'text/html' } });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    return calls;
  }

  it('takes the full-text fetch, not the routing preview, when file.size sits exactly at the limit (strict >, not >=)', async () => {
    const plainHtml = '<html><body><h1>Just under</h1></body></html>';
    const calls = stubSizeGateFetch(plainHtml);

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlFile({ size: FULL_TEXT_LIMIT })}
      />,
    );

    await waitFor(() => {
      expect(calls.some((url) => url.includes('/raw/preview.html'))).toBe(true);
    });
    expect(calls.some((url) => url.includes('/text-preview/'))).toBe(false);
  });

  it('defers to the routing-preview fetch, capped at the hardcoded routing-preview limit, one byte past the full-text limit', async () => {
    const plainHtml = '<html><body><h1>Just over</h1></body></html>';
    const calls = stubSizeGateFetch(plainHtml);

    render(
      <FileViewer
        projectId="project-1"
        projectKind="prototype"
        file={htmlFile({ size: FULL_TEXT_LIMIT + 1 })}
      />,
    );

    await waitFor(() => {
      expect(calls.some((url) => url.includes('/text-preview/preview.html'))).toBe(true);
    });
    const previewCall = calls.find((url) => url.includes('/text-preview/preview.html'));
    // Hardcoded literal (98304 = 96 * 1024), NOT the imported
    // HTML_ROUTING_TEXT_PREVIEW_LIMIT constant, so a silent drift in that
    // constant's value moves only production and this assertion catches it.
    expect(previewCall).toContain('limit=98304');
    // Plain HTML triggers none of previewTextNeedsFullSourceForSafeInline's
    // guards, so the routing-preview text is accepted as-is and the fallback
    // full-text fetch (fetchProjectFileText) must never fire.
    expect(calls.some((url) => url.includes('/raw/preview.html'))).toBe(false);
  });
});

describe('HtmlViewer ?forceInline=1 wiring', () => {
  it('routes an otherwise URL-loadable HTML preview through the srcDoc iframe when the host page carries ?forceInline=1', async () => {
    stubPreviewFetch();
    const plainHtml = '<html><body><h1>Hello</h1></body></html>';

    // Baseline: no forceInline — plain HTML with none of the srcDoc-only
    // triggers URL-loads by default.
    const baseline = render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} liveHtml={plainHtml} />,
    );
    expect(
      (screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement).getAttribute('data-od-render-mode'),
    ).toBe('url-load');
    baseline.unmount();
    cleanup();

    // `forceInline` is read from `window.location.search` once at mount, so
    // it must be set before the forced render.
    window.history.replaceState(null, '', '/?forceInline=1');

    render(
      <FileViewer projectId="project-1" projectKind="prototype" file={htmlFile()} liveHtml={plainHtml} />,
    );

    const frame = screen.getByTestId('artifact-preview-frame') as HTMLIFrameElement;
    expect(frame.getAttribute('data-od-render-mode')).toBe('srcdoc');
    // The now-inactive URL-load iframe must be parked at about:blank, not
    // left pointed at the live raw-file URL, while it sits hidden.
    const urlFrame = screen.getByTestId('artifact-preview-frame-url-load') as HTMLIFrameElement;
    expect(urlFrame.getAttribute('data-od-active')).toBe('false');
    expect(urlFrame.getAttribute('src')).toBe('about:blank');
  });
});
