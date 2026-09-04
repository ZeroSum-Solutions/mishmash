// @vitest-environment jsdom
// W2H.1 red spec — what a preview frame has to show before the watchdog stops
// watching it, and which document is allowed to show it.
//
// W2G.1 settled every srcDoc transport on `od:preview-content-size`, and round
// 2 refused that as sufficient on two counts:
//
//   1. Zero visible output. The report proves the document RAN, not that it
//      put anything on screen. `iframe-preview-watchdog.test.ts` pinned the old
//      rule in as many words: "settles a report of any measurement, including
//      one that measured nothing". A 200 that lays out to nothing therefore
//      settles the watchdog and records nothing, which is the defect F1 names.
//   2. The post-navigation race. `iframe.contentWindow` is the same WindowProxy
//      across a navigation, so `event.source === iframe.contentWindow` cannot
//      tell the outgoing document from the incoming one. A watchdog installed
//      for a new `previewUrl` is answered by the document still in the frame,
//      settles on it, and the stuck replacement that loads a moment later is
//      never watched at all.
//
// Both cases run against the real host watchdog with a real jsdom iframe; the
// frame's answers are dispatched by hand because the point is WHICH answer the
// host accepts, not whether a producer can measure.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackPreviewPaint } from '../../src/observability/iframe-error';

const REPORT = 'od:preview-content-size';
const REPORT_REQUEST = 'od:preview-content-size-request';

interface MountedFrame {
  iframe: HTMLIFrameElement;
  posted: Array<Record<string, unknown>>;
}

function mountFrame(): MountedFrame {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const posted: Array<Record<string, unknown>> = [];
  Object.defineProperty(iframe.contentWindow, 'postMessage', {
    configurable: true,
    value: (data: unknown) => posted.push(data as Record<string, unknown>),
  });
  return { iframe, posted };
}

/** The token the host most recently handed the frame, if the protocol has one. */
function latestRequestToken(posted: ReadonlyArray<Record<string, unknown>>): unknown {
  const requests = posted.filter((message) => message?.type === REPORT_REQUEST);
  return requests.length === 0 ? undefined : requests[requests.length - 1]?.token;
}

function answerFrom(frame: MountedFrame, data: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent('message', { data, source: frame.iframe.contentWindow }),
  );
}

function anomalyPosts(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter((call) => call[0] === '/api/anomalies')
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>);
}

function previewErrors(fetchMock: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  return anomalyPosts(fetchMock).filter((record) => record.kind === 'preview-error');
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('a preview settles only on positive render evidence', () => {
  it('does not settle on a report that measured nothing, and files a preview-error', () => {
    const frame = mountFrame();
    const dispose = trackPreviewPaint({ iframe: frame.iframe, surface: 'file_viewer_preview' });

    frame.iframe.dispatchEvent(new Event('load'));
    // The document ran and answered. It laid out to nothing: no element in it
    // has a box with area. That is the zero-visible-output case, and it is a
    // failure the user can see — a blank canvas — not a healthy preview.
    answerFrom(frame, {
      type: REPORT,
      width: null,
      painted: false,
      token: latestRequestToken(frame.posted),
    });

    vi.advanceTimersByTime(30_000);
    dispose();

    const filed = previewErrors(fetchMock);
    expect(filed).toHaveLength(1);
  });

  it('settles on a report that carries positive render evidence', () => {
    const frame = mountFrame();
    const dispose = trackPreviewPaint({ iframe: frame.iframe, surface: 'file_viewer_preview' });

    frame.iframe.dispatchEvent(new Event('load'));
    answerFrom(frame, {
      type: REPORT,
      width: 1280,
      painted: true,
      token: latestRequestToken(frame.posted),
    });

    vi.advanceTimersByTime(30_000);
    dispose();

    expect(previewErrors(fetchMock)).toHaveLength(0);
  });
});

describe('a watchdog is bound to the document it was installed for', () => {
  it('does not let the outgoing document settle the watchdog for its replacement', () => {
    // The shape of the race: `previewUrl` changed, so the effect re-ran and a
    // fresh watchdog is installed, but the browser has not swapped documents
    // yet. The host asks for a report; the OLD document — which really did
    // paint — answers. Then the replacement loads and hangs.
    const frame = mountFrame();
    const dispose = trackPreviewPaint({ iframe: frame.iframe, surface: 'file_viewer_preview' });

    const staleToken = latestRequestToken(frame.posted);
    answerFrom(frame, { type: REPORT, width: 1280, painted: true, token: staleToken });

    // The replacement arrives. It is stuck: it never reports.
    frame.iframe.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(30_000);
    dispose();

    const filed = previewErrors(fetchMock);
    expect(
      filed,
      'the stuck replacement escaped the watchdog: the previous document had already settled it',
    ).toHaveLength(1);
  });

  it('ignores a late answer from the outgoing document after the replacement loaded', () => {
    const frame = mountFrame();
    const dispose = trackPreviewPaint({ iframe: frame.iframe, surface: 'file_viewer_preview' });

    const staleToken = latestRequestToken(frame.posted);
    frame.iframe.dispatchEvent(new Event('load'));
    // Queued inside the outgoing document before it was torn down, delivered
    // after the replacement loaded. Same WindowProxy, so source matching
    // cannot reject it; only the navigation binding can.
    answerFrom(frame, { type: REPORT, width: 1280, painted: true, token: staleToken });

    vi.advanceTimersByTime(30_000);
    dispose();

    expect(previewErrors(fetchMock)).toHaveLength(1);
  });

  it('still settles when the replacement itself paints', () => {
    const frame = mountFrame();
    const dispose = trackPreviewPaint({ iframe: frame.iframe, surface: 'file_viewer_preview' });

    answerFrom(frame, {
      type: REPORT,
      width: 1280,
      painted: true,
      token: latestRequestToken(frame.posted),
    });
    frame.iframe.dispatchEvent(new Event('load'));
    answerFrom(frame, {
      type: REPORT,
      width: 1280,
      painted: true,
      token: latestRequestToken(frame.posted),
    });

    vi.advanceTimersByTime(30_000);
    dispose();

    expect(previewErrors(fetchMock)).toHaveLength(0);
  });
});
