import { describe, expect, it } from 'vitest';

import { exportErrorCode } from '../../src/analytics/export-error-code';

describe('exportErrorCode', () => {
  it('classifies the daemon↔desktop sidecar version skew from its wrapped message', () => {
    // The exact string the daemon surfaces when a freshly-updated daemon sends
    // `render-slides` to an older desktop that predates the message. Before this
    // helper it was reported as the generic "Error", hiding the skew in analytics.
    const err = new Error(
      'desktop renderer unavailable: unknown desktop sidecar message: render-slides',
    );
    expect(exportErrorCode(err)).toBe('DESKTOP_SIDECAR_UNKNOWN_MESSAGE');
  });

  it('classifies a plain renderer-unavailable failure separately from the skew', () => {
    expect(exportErrorCode(new Error('desktop renderer unavailable: connection refused'))).toBe(
      'DESKTOP_RENDERER_UNAVAILABLE',
    );
  });

  // FU-48: before #242, `exportErrorCode` had no CAPTURE_* branches at all — a
  // generic timeout classified as the error's own name. #242 added
  // CAPTURE_TIMEOUT / CAPTURE_EMPTY_RENDER / CAPTURE_TAINTED so
  // `bridgeCaptureFailureErrorCode` could share one mapping, but left them on
  // the SAME generic classifier that `fireShareExport` uses for every
  // non-image export (PDF, ZIP, HTML, Markdown, PPTX, share-link, share-page).
  // That misattributes a plain share-link/PDF timeout as a snapshot-capture
  // failure in `artifact_export_result.error_code` (and in the anomaly-report
  // labelling at `observability/anomaly-report.ts:294-297`). This used to be
  // "classifies snapshot bridge failure reasons" and asserted the OPPOSITE —
  // that `exportErrorCode('timeout')` etc. returned CAPTURE_* — which was the
  // defect this track removes. The capture-only mapping now lives on the new
  // `captureErrorCode` (exercised through the component test, since it is not
  // itself part of the generic classifier's public contract).
  it('never classifies a generic failure as a capture-stage code, even when the message matches a capture signature', () => {
    expect(exportErrorCode(new Error('share link request timeout'))).not.toBe('CAPTURE_TIMEOUT');
    expect(exportErrorCode(new Error('share link request timeout'))).toBe('Error');

    const timeoutNamedErr = new Error('request aborted');
    timeoutNamedErr.name = 'TimeoutError';
    expect(exportErrorCode(timeoutNamedErr)).not.toBe('CAPTURE_TIMEOUT');
    expect(exportErrorCode(timeoutNamedErr)).toBe('TimeoutError');

    expect(exportErrorCode(new Error('empty-render'))).not.toBe('CAPTURE_EMPTY_RENDER');
    expect(exportErrorCode(new Error('empty-render'))).toBe('Error');

    expect(exportErrorCode(new Error('tainted-canvas'))).not.toBe('CAPTURE_TAINTED');
    expect(exportErrorCode(new Error('tainted-canvas'))).toBe('Error');

    const securityErr = new Error('The operation is insecure.');
    securityErr.name = 'SecurityError';
    expect(exportErrorCode(securityErr)).not.toBe('CAPTURE_TAINTED');
    expect(exportErrorCode(securityErr)).toBe('SecurityError');
  });

  it('prefers a structured .code over message classification', () => {
    const err = Object.assign(new Error('desktop renderer unavailable: unknown desktop sidecar message: render-slides'), {
      code: 'UPSTREAM_UNAVAILABLE',
    });
    expect(exportErrorCode(err)).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('falls back to the error name for unclassified failures', () => {
    expect(exportErrorCode(new TypeError('boom'))).toBe('TypeError');
    expect(exportErrorCode(new Error('export request failed (500)'))).toBe('Error');
  });

  it('returns UNKNOWN for non-Error throwables', () => {
    expect(exportErrorCode('nope')).toBe('UNKNOWN');
    expect(exportErrorCode(undefined)).toBe('UNKNOWN');
  });
});
