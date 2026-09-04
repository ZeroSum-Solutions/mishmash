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

  it('takes the failure back when a document that failed reloads into one that paints', () => {
    // The notice the caller draws is keyed on this callback, so a stale
    // "did not render" must not survive the document it described.
    const states: string[] = [];
    const frame = mountFrame();
    const dispose = trackPreviewPaint({
      iframe: frame.iframe,
      surface: 'file_viewer_preview',
      onPaintState: (state) => states.push(state.status),
    });

    frame.iframe.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(30_000);
    expect(states.at(-1)).toBe('unproven');

    frame.iframe.dispatchEvent(new Event('load'));
    expect(states.at(-1), 'a new document is watched, and nothing is known about it yet').toBe('watching');
    answerFrom(frame, {
      type: REPORT,
      width: 1280,
      painted: true,
      token: latestRequestToken(frame.posted),
    });
    dispose();

    expect(states.at(-1)).toBe('painted');
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

// W2H.1b red spec — D-17 landing condition 1. `arm()` mints a navigation token
// and immediately posts it to whichever document still occupies the
// WindowProxy, so the OUTGOING document learns the token minted for its
// replacement and can settle the replacement's watchdog before `load`. If the
// replacement then hangs, nothing ever fires. The same call also restarts the
// 15 s deadline on every `load`, so a document that takes 10 s to commit gets
// 25 s of budget instead of 15 s.
//
// The fix is a two-phase epoch: arming starts the deadline and discloses
// nothing; the incoming `load` is what discloses the token, and it neither
// mints a new one nor restarts the deadline.
describe('a navigation epoch is bound to the document that commits into the frame', () => {
  it('discloses nothing to the frame until a document commits into it', () => {
    const frame = mountFrame();
    const dispose = trackPreviewPaint({ iframe: frame.iframe, surface: 'file_viewer_preview' });

    expect(
      frame.posted.filter((message) => message?.type === REPORT_REQUEST),
      'the document still in the frame must not learn the token minted for its replacement',
    ).toHaveLength(0);

    frame.iframe.dispatchEvent(new Event('load'));
    expect(
      frame.posted.filter((message) => message?.type === REPORT_REQUEST),
      'the committed document is asked, exactly once, for the epoch it commits into',
    ).toHaveLength(1);

    dispose();
  });

  it('does not let the document still in the frame settle a navigation the host just armed', () => {
    const frame = mountFrame();

    // A first document loads and paints; the watchdog settles on it.
    const first = trackPreviewPaint({ iframe: frame.iframe, surface: 'live_artifact_preview' });
    frame.iframe.dispatchEvent(new Event('load'));
    answerFrom(frame, {
      type: REPORT,
      width: 1280,
      painted: true,
      token: latestRequestToken(frame.posted),
    });
    first();

    // The host now points the frame at a different artifact and installs a
    // fresh watchdog. The browser has not swapped documents yet, so the OLD
    // document is still the one listening — and it still paints, so it answers
    // with the newest token this frame has been given.
    const dispose = trackPreviewPaint({ iframe: frame.iframe, surface: 'live_artifact_preview' });
    answerFrom(frame, {
      type: REPORT,
      width: 1280,
      painted: true,
      token: latestRequestToken(frame.posted),
    });

    // The replacement then hangs: it never commits at all.
    vi.advanceTimersByTime(30_000);
    dispose();

    expect(
      previewErrors(fetchMock),
      'the outgoing document answered for a navigation that never loaded, and the stuck replacement escaped the watchdog',
    ).toHaveLength(1);
  });

  it('starts the deadline when the navigation is armed, not when the document loads', () => {
    const frame = mountFrame();
    const dispose = trackPreviewPaint({ iframe: frame.iframe, surface: 'file_viewer_preview' });

    vi.advanceTimersByTime(10_000);
    frame.iframe.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(6_000);
    dispose();

    expect(
      previewErrors(fetchMock),
      'the 15 s budget covers the whole navigation, not just the part after the document commits',
    ).toHaveLength(1);
  });

  it('files one preview-error for a failure, however many stale reports arrived', () => {
    const frame = mountFrame();

    const first = trackPreviewPaint({ iframe: frame.iframe, surface: 'file_viewer_preview' });
    frame.iframe.dispatchEvent(new Event('load'));
    const staleToken = latestRequestToken(frame.posted);
    first();

    const dispose = trackPreviewPaint({ iframe: frame.iframe, surface: 'file_viewer_preview' });
    for (let i = 0; i < 5; i += 1) {
      answerFrom(frame, { type: REPORT, width: 1280, painted: true, token: staleToken });
    }

    vi.advanceTimersByTime(30_000);
    dispose();

    const filed = previewErrors(fetchMock);
    expect(filed, 'stale reports are counted, not filed one anomaly each').toHaveLength(1);
    expect(
      (filed[0]?.detail as Record<string, unknown> | undefined)?.stale_token_reports,
      'the count of reports the epoch rejected belongs in the one failure record',
    ).toBe(5);
  });
});
