// @vitest-environment jsdom
// W2I.1 red spec — wave-2 round 3, finding F4 (MEDIUM). The host keeps asking
// until the document settles or the deadline runs out.
//
// `discloseToCommittedDocument` asked the frame twice: once at commit and once
// at `COMMIT_RETRY_MS`. The producers post unsolicited reports on their own
// 0/80/260 ms timers, on `fonts.ready`, on `resize` and through a
// `ResizeObserver` — so a document whose LAYOUT never changes and whose paint
// lands after that second ask triggers none of them, and the host files a
// `client_iframe_timeout` at 15 s for a preview the user is looking at. A
// stable-size canvas that draws at 3 s is exactly that document.
//
// The producer already answers `PREVIEW_PAINT_REPORT_REQUEST` with a fresh
// scan, so the host has to do nothing more than keep asking — inside the
// deadline it already owns, with no second deadline concept.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { safetyEvents } = vi.hoisted(() => ({
  safetyEvents: [] as Array<{ name: string; properties: Record<string, unknown> }>,
}));

vi.mock('../../src/analytics/error-tracking', () => ({
  reportSafetyEvent: (name: string, properties: Record<string, unknown> = {}) => {
    safetyEvents.push({ name, properties });
  },
}));

import { trackPreviewPaint } from '../../src/observability/iframe-error';
import type { PreviewPaintState } from '../../src/observability/iframe-error';

const REPORT = 'od:preview-content-size';
const REPORT_REQUEST = 'od:preview-content-size-request';

/** The host's own constants, restated so the cases read in the units they use. */
const LOAD_TIMEOUT_MS = 15_000;
const COMMIT_RETRY_MS = 1_500;

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

function requests(frame: MountedFrame): Array<Record<string, unknown>> {
  return frame.posted.filter((message) => message?.type === REPORT_REQUEST);
}

function latestRequestToken(frame: MountedFrame): unknown {
  const asked = requests(frame);
  return asked.length === 0 ? undefined : asked[asked.length - 1]?.token;
}

function answerFrom(frame: MountedFrame, data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data, source: frame.iframe.contentWindow }));
}

/** A report from a document that laid out and painted text. */
const PAINTED = {
  type: REPORT,
  width: 1280,
  painted: true,
  reason: 'painted',
  evidence: null,
  counters: { seen: 3, hidden: 0, clipped: 0, blank: 1, imageUnverified: 0 },
};

beforeEach(() => {
  vi.useFakeTimers();
  safetyEvents.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('the host keeps asking until the document settles or the deadline passes', () => {
  it('asks again past the single retry, so a stable-size late paint still settles', () => {
    const frame = mountFrame();
    const states: PreviewPaintState[] = [];
    const dispose = trackPreviewPaint({
      iframe: frame.iframe,
      surface: 'file_viewer_preview',
      onPaintState: (state) => states.push(state),
    });
    frame.iframe.dispatchEvent(new Event('load'));

    // Nothing about this document changes size, so no producer trigger fires
    // between the second ask and the paint at 3 s.
    vi.advanceTimersByTime(3_000);
    expect(
      requests(frame).length,
      'two asks cover the first 1.5 s only; a document painting at 3 s is never asked again',
    ).toBeGreaterThan(2);

    answerFrom(frame, { ...PAINTED, token: latestRequestToken(frame) });
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS);

    expect(states.map((state) => state.status)).toContain('painted');
    expect(
      safetyEvents.filter((event) => event.name === 'client_iframe_timeout'),
      'the document proved it painted well inside the deadline',
    ).toHaveLength(0);
    dispose();
  });

  it('stops asking the moment the document settles', () => {
    const frame = mountFrame();
    const dispose = trackPreviewPaint({ iframe: frame.iframe, surface: 'file_viewer_preview' });
    frame.iframe.dispatchEvent(new Event('load'));

    answerFrom(frame, { ...PAINTED, token: latestRequestToken(frame) });
    const asked = requests(frame).length;
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS);

    expect(requests(frame).length, 'a settled epoch asks nothing more').toBe(asked);
    dispose();
  });

  it('stops asking at the deadline and files the timeout exactly once', () => {
    const frame = mountFrame();
    const dispose = trackPreviewPaint({ iframe: frame.iframe, surface: 'file_viewer_preview' });
    frame.iframe.dispatchEvent(new Event('load'));

    vi.advanceTimersByTime(LOAD_TIMEOUT_MS + COMMIT_RETRY_MS * 4);

    const timeouts = safetyEvents.filter((event) => event.name === 'client_iframe_timeout');
    expect(timeouts, 'a document that never answers still fails once, at the deadline').toHaveLength(1);
    const asked = requests(frame).length;
    expect(
      asked,
      'the re-ask is bounded by the deadline the watchdog already owns, not by a new one',
    ).toBeLessThanOrEqual(Math.ceil(LOAD_TIMEOUT_MS / COMMIT_RETRY_MS) + 1);

    vi.advanceTimersByTime(LOAD_TIMEOUT_MS);
    expect(requests(frame).length, 'and nothing is asked after it').toBe(asked);
    dispose();
  });
});
