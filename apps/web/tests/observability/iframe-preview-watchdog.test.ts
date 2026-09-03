// @vitest-environment jsdom
// The two halves of the preview watchdog's protocol, pinned together.
//
// `trackIframeLoad({ settlesOn: 'document-report' })` refuses to accept the
// frame's own `load` event as proof the artifact appeared, and waits for
// `od:preview-content-size` from inside the frame instead. That only works if
// the document really does answer — so this file drives the REAL bridge script
// that `buildSrcdoc` injects, in a sandbox, rather than trusting a
// hand-dispatched message. If either half is removed the pair fails here
// instead of silently filing a `preview-error` for every healthy preview.

import vm from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSrcdoc } from '../../src/runtime/srcdoc';
import { trackIframeLoad } from '../../src/observability/iframe-error';

const REPORT = 'od:preview-content-size';
const REPORT_REQUEST = 'od:preview-content-size-request';

function extractContentSizeBridge(doc: string): string {
  const match = doc.match(
    /<script\s+data-od-preview-content-size-bridge>([\s\S]*?)<\/script>/,
  );
  if (!match || match[1] == null) {
    throw new Error('preview content-size bridge script not found in srcdoc');
  }
  return match[1];
}

interface BridgeRun {
  parentMessages: Array<{ type?: string; width?: number | null }>;
  send: (data: unknown) => void;
  flushFrames: () => void;
}

/** Runs the injected bridge with the globals a sandboxed srcdoc document has. */
function runContentSizeBridge(doc: string): BridgeRun {
  const parentMessages: Array<{ type?: string; width?: number | null }> = [];
  const listeners: Record<string, Array<(ev: unknown) => void>> = {};
  const frameCallbacks: Array<() => void> = [];
  const win: Record<string, unknown> = {
    parent: { postMessage: (data: unknown) => parentMessages.push(data as never) },
    addEventListener(type: string, listener: (ev: unknown) => void) {
      (listeners[type] ??= []).push(listener);
    },
    requestAnimationFrame(callback: () => void) {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    },
  };
  const sandbox: Record<string, unknown> = {
    window: win,
    document: {
      readyState: 'complete',
      documentElement: { scrollWidth: 1280, offsetWidth: 1280, clientWidth: 1280 },
      body: { scrollWidth: 1280, offsetWidth: 1280, clientWidth: 1280 },
      addEventListener: () => {},
    },
    setTimeout: () => 0,
  };
  vm.createContext(sandbox);
  vm.runInContext(extractContentSizeBridge(doc), sandbox);
  return {
    parentMessages,
    send: (data: unknown) => {
      for (const listener of listeners.message ?? []) listener({ data });
    },
    flushFrames: () => {
      const queued = frameCallbacks.splice(0, frameCallbacks.length);
      for (const callback of queued) callback();
    },
  };
}

describe('the artifact document half of the preview watchdog protocol', () => {
  it('is injected into every preview srcdoc and answers the watchdog request', () => {
    const doc = buildSrcdoc('<html><body><h1>Artifact</h1></body></html>', {
      selectionBridge: true,
      editBridge: true,
      previewFocusGuard: true,
    });

    const bridge = runContentSizeBridge(doc);
    bridge.send({ type: REPORT_REQUEST });
    bridge.flushFrames();

    const report = bridge.parentMessages.find((message) => message?.type === REPORT);
    expect(report).toBeDefined();
    expect(report?.width).toBe(1280);
  });
});

describe('the host half of the preview watchdog protocol', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  function mountFrame(): { iframe: HTMLIFrameElement; posted: unknown[] } {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const posted: unknown[] = [];
    // jsdom gives the frame a real contentWindow; intercept its postMessage so
    // the watchdog's "report yourself now" ask is observable.
    Object.defineProperty(iframe.contentWindow, 'postMessage', {
      configurable: true,
      value: (data: unknown) => posted.push(data),
    });
    return { iframe, posted };
  }

  function anomalyPosts(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
    return fetchMock.mock.calls
      .filter((call) => call[0] === '/api/anomalies')
      .map((call) => JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>);
  }

  it('asks the document to report itself and settles on the answer', () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { iframe, posted } = mountFrame();

    const dispose = trackIframeLoad({
      iframe,
      surface: 'file_viewer_preview',
      settlesOn: 'document-report',
    });

    expect(posted).toContainEqual({ type: REPORT_REQUEST });

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: REPORT, width: 1280 },
        source: iframe.contentWindow,
      }),
    );
    vi.advanceTimersByTime(30_000);
    dispose();

    expect(anomalyPosts(fetchMock)).toHaveLength(0);
  });

  it('does not accept the frame load event as proof, and files a preview-error', () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { iframe } = mountFrame();

    const dispose = trackIframeLoad({
      iframe,
      surface: 'file_viewer_preview',
      settlesOn: 'document-report',
    });

    iframe.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(30_000);
    dispose();

    const filed = anomalyPosts(fetchMock);
    expect(filed).toHaveLength(1);
    expect(filed[0]?.kind).toBe('preview-error');
  });

  it('still settles a plain url-loaded frame on its own load event', () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { iframe, posted } = mountFrame();

    const dispose = trackIframeLoad({ iframe, surface: 'live_artifact_preview' });

    // The default evidence is unchanged: no ask, and `load` is enough.
    expect(posted).toHaveLength(0);
    iframe.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(30_000);
    dispose();

    expect(anomalyPosts(fetchMock)).toHaveLength(0);
  });
});
