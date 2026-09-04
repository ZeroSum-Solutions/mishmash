// @vitest-environment jsdom
// The two halves of the preview watchdog's protocol, pinned together.
//
// `trackPreviewPaint` refuses to accept the frame's own `load` event as proof
// the artifact appeared, and waits for an `od:preview-content-size` report
// carrying positive render evidence from inside the frame instead. That only
// works if the document really does answer — so this file drives the REAL
// bridge script that `buildSrcdoc` injects, in a sandbox, rather than trusting
// a hand-dispatched message. If either half is removed the pair fails here
// instead of silently filing a `preview-error` for every healthy preview.
//
// W2H.1 moved two things this file pins. A report settles only when it carries
// `painted: true` — running is not rendering — and only when it echoes the
// navigation token of the arming it answers. The cases those rules create in
// their own right (zero visible output, the post-navigation race) are in
// `iframe-preview-paint-evidence.test.ts`.

import vm from 'node:vm';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSrcdoc } from '../../src/runtime/srcdoc';
import { trackPreviewPaint } from '../../src/observability/iframe-error';

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
  parentMessages: Array<Record<string, unknown>>;
  send: (data: unknown) => void;
  flushFrames: () => void;
}

/** Runs the injected bridge with the globals a sandboxed srcdoc document has. */
function runContentSizeBridge(doc: string): BridgeRun {
  const parentMessages: Array<Record<string, unknown>> = [];
  const listeners: Record<string, Array<(ev: unknown) => void>> = {};
  const frameCallbacks: Array<() => void> = [];
  const win: Record<string, unknown> = {
    parent: { postMessage: (data: unknown) => parentMessages.push(data as Record<string, unknown>) },
    addEventListener(type: string, listener: (ev: unknown) => void) {
      (listeners[type] ??= []).push(listener);
    },
    requestAnimationFrame(callback: () => void) {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    },
  };
  // A laid-out document: the body has a box with area, which is the positive
  // render evidence the watchdog settles on.
  const laidOut = {
    scrollWidth: 1280,
    offsetWidth: 1280,
    clientWidth: 1280,
    getBoundingClientRect: () => ({ width: 1280, height: 720 }),
    querySelectorAll: () => [],
  };
  const sandbox: Record<string, unknown> = {
    window: win,
    document: {
      readyState: 'complete',
      documentElement: laidOut,
      body: laidOut,
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
    bridge.send({ type: REPORT_REQUEST, token: 'nav-1' });
    bridge.flushFrames();

    const report = bridge.parentMessages.find((message) => message?.type === REPORT);
    expect(report).toBeDefined();
    expect(report?.width).toBe(1280);
    expect(report?.painted).toBe(true);
    expect(report?.token, 'the answer names the arming it answers').toBe('nav-1');
  });

  it('keeps answering with the token it was last asked with, so a late paint still settles', () => {
    // The document is asked once, at install and again on load; every later
    // report it makes on its own (fonts ready, a resize, its own timers) has
    // to carry that token or the host cannot accept it.
    const doc = buildSrcdoc('<html><body><h1>Artifact</h1></body></html>', {});
    const bridge = runContentSizeBridge(doc);

    bridge.send({ type: REPORT_REQUEST, token: 'nav-7' });
    // The zoom-fitting measurement asks without a token; that must not erase
    // the watchdog's.
    bridge.send({ type: REPORT_REQUEST });

    const tokens = bridge.parentMessages
      .filter((message) => message?.type === REPORT)
      .map((message) => message?.token);
    expect(tokens.length).toBeGreaterThan(1);
    expect(tokens.every((token) => token === 'nav-7')).toBe(true);
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

  function mountFrame(): { iframe: HTMLIFrameElement; posted: Array<Record<string, unknown>> } {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const posted: Array<Record<string, unknown>> = [];
    // jsdom gives the frame a real contentWindow; intercept its postMessage so
    // the watchdog's "report yourself now" ask is observable.
    Object.defineProperty(iframe.contentWindow, 'postMessage', {
      configurable: true,
      value: (data: unknown) => posted.push(data as Record<string, unknown>),
    });
    return { iframe, posted };
  }

  function requestToken(posted: ReadonlyArray<Record<string, unknown>>): unknown {
    const requests = posted.filter((message) => message?.type === REPORT_REQUEST);
    return requests.length === 0 ? undefined : requests[requests.length - 1]?.token;
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

    const dispose = trackPreviewPaint({ iframe, surface: 'file_viewer_preview' });

    const asks = posted.filter((message) => message?.type === REPORT_REQUEST);
    expect(asks).toHaveLength(1);
    expect(typeof asks[0]?.token).toBe('string');

    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: REPORT, width: 1280, painted: true, token: requestToken(posted) },
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

    const dispose = trackPreviewPaint({ iframe, surface: 'file_viewer_preview' });

    iframe.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(30_000);
    dispose();

    const filed = anomalyPosts(fetchMock);
    expect(filed).toHaveLength(1);
    expect(filed[0]?.kind).toBe('preview-error');
  });

  it('holds every visible preview transport to the same evidence', () => {
    // The powered cross-origin copy used to take the frame's `load` event,
    // because nothing had confirmed its report crossed back from the isolated
    // origin. e2e/ui/powered-preview-paint-report.test.ts confirmed it in a
    // real browser, so the exemption is gone and this surface is watched like
    // the rest.
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { iframe, posted } = mountFrame();

    const dispose = trackPreviewPaint({ iframe, surface: 'file_viewer_preview_powered' });

    expect(posted.filter((message) => message?.type === REPORT_REQUEST)).toHaveLength(1);
    iframe.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(30_000);
    dispose();

    const filed = anomalyPosts(fetchMock);
    expect(filed).toHaveLength(1);
    expect(filed[0]?.kind).toBe('preview-error');
  });
});
