// @vitest-environment jsdom
// W2H.1d red spec — D-17 dialogue round 4, the host half of the transparent-
// output blocker.
//
// The producer can prove a document painted for every source it can read. A
// raster image is the one it cannot: pixel transparency is decidable only
// through an untainted canvas, and in the sandboxed opaque-origin preview
// frame every http(s) image is cross-origin. The position the fix takes is to
// report that case rather than guess it — `painted: true`, plus
// `evidence: 'image-unverified'` — and a settle on that evidence is only
// honest if the host SAYS SO. Left silent, an unread image is indistinguishable
// from proof in every dashboard downstream.
//
// The watchdog emits no success event by design (it would multiply ingest cost
// for the most common case). This is the exception, and it is bounded by the
// same rule: it fires only when the evidence carries a caveat.
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

/** The token the host most recently handed the frame. */
function latestRequestToken(posted: ReadonlyArray<Record<string, unknown>>): unknown {
  const requests = posted.filter((message) => message?.type === REPORT_REQUEST);
  return requests.length === 0 ? undefined : requests[requests.length - 1]?.token;
}

function answerFrom(frame: MountedFrame, data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data, source: frame.iframe.contentWindow }));
}

/** Settles a freshly armed watchdog with one report, and returns the events it emitted. */
function settleWith(report: Record<string, unknown>): typeof safetyEvents {
  const frame = mountFrame();
  const dispose = trackPreviewPaint({
    iframe: frame.iframe,
    surface: 'file_viewer_preview',
    artifactId: 'artifact-1',
  });
  frame.iframe.dispatchEvent(new Event('load'));
  answerFrom(frame, { type: REPORT, ...report, token: latestRequestToken(frame.posted) });
  vi.advanceTimersByTime(30_000);
  dispose();
  return safetyEvents;
}

beforeEach(() => {
  vi.useFakeTimers();
  safetyEvents.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('a settle on unverified image evidence is recorded, not assumed', () => {
  it('records the evidence class when the only paint source was an unread image', () => {
    const events = settleWith({
      width: 1280,
      painted: true,
      reason: 'painted',
      evidence: 'image-unverified',
      counters: { seen: 4, hidden: 0, clipped: 0, blank: 2, imageUnverified: 1 },
    });

    const recorded = events.filter((event) => event.name === 'client_iframe_paint_unverified');
    expect(
      recorded,
      'a preview settled on pixels nobody read; the telemetry has to carry that',
    ).toHaveLength(1);
    expect(recorded[0]!.properties.report_evidence).toBe('image-unverified');
    expect(recorded[0]!.properties.report_image_unverified).toBe(1);
    expect(recorded[0]!.properties.surface).toBe('file_viewer_preview');
    expect(
      events.some((event) => event.name.startsWith('client_iframe_timeout')),
      'the watchdog settled: this is not a failure',
    ).toBe(false);
  });

  it('says nothing for a settle on evidence the producer could read', () => {
    // The bound on the exception: the common case stays silent, which is why
    // the watchdog has no success event in the first place.
    const events = settleWith({
      width: 1280,
      painted: true,
      reason: 'painted',
      evidence: null,
      counters: { seen: 2, hidden: 0, clipped: 0, blank: 1, imageUnverified: 0 },
    });

    expect(events, 'a report that stands on its own evidence is not news').toHaveLength(0);
  });

  it('says nothing for a report from a document that predates the evidence field', () => {
    // A document served before this change reports no `evidence` at all. The
    // absence of a caveat is not a caveat.
    const events = settleWith({ width: 1280, painted: true });

    expect(events).toHaveLength(0);
  });
});
