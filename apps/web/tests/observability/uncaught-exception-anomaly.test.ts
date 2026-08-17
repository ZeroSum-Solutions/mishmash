import { beforeEach, describe, expect, it } from 'vitest';

import {
  anomalyForUncaughtException,
  resetUncaughtExceptionAnomalyState,
  shouldFileUncaughtException,
} from '../../src/observability/anomaly-report';

// `AnomalyKind` has carried 'unhandled-error' since the anomaly log landed, but
// nothing ever produced one: browser exceptions went only to PostHog, which is a
// no-op without a build-time key. These assertions pin the missing half — an
// uncaught error and an unhandled rejection each become a record — and the flood
// guard that has to come with it, because an error loop firing every frame would
// otherwise write until the 8 MB log rotated every earlier record away.

describe('uncaught exception → anomaly mapping', () => {
  beforeEach(() => {
    resetUncaughtExceptionAnomalyState();
  });

  it('files an uncaught error as unhandled-error at error severity', () => {
    const anomaly = anomalyForUncaughtException({
      message: "Cannot read properties of undefined (reading 'map')",
      source: 'https://app.local/static/chunk.js',
      lineno: 42,
    });

    expect(anomaly.kind).toBe('unhandled-error');
    expect(anomaly.severity).toBe('error');
    expect(anomaly.summary).toContain("reading 'map'");
  });

  it('names the originating source in the summary so a record is actionable', () => {
    const anomaly = anomalyForUncaughtException({
      message: 'boom',
      source: 'https://app.local/static/chunk.js',
      lineno: 42,
    });

    expect(anomaly.summary).toContain('chunk.js');
    expect(anomaly.detail).toMatchObject({ source: expect.stringContaining('chunk.js') });
  });

  it('distinguishes a rejection from a thrown error in the record', () => {
    const rejection = anomalyForUncaughtException({
      message: 'Unhandled promise rejection',
      rejection: true,
    });

    expect(rejection.kind).toBe('unhandled-error');
    expect(rejection.detail).toMatchObject({ rejection: true });
  });

  it('survives an exception with no source, line, or usable message', () => {
    const anomaly = anomalyForUncaughtException({ message: '' });

    expect(anomaly.kind).toBe('unhandled-error');
    expect(anomaly.summary.length).toBeGreaterThan(0);
  });

  // The flood guard. Without it this change makes the log strictly worse: a
  // render loop throwing on every frame rotates 8 MB of duplicates over the
  // history a reader actually needs.
  describe('flood guard', () => {
    it('files the first occurrence of a signature', () => {
      expect(shouldFileUncaughtException('TypeError: x is not a function')).toBe(true);
    });

    it('suppresses an identical signature repeating in a tight loop', () => {
      const signature = 'TypeError: x is not a function';
      expect(shouldFileUncaughtException(signature)).toBe(true);

      for (let i = 0; i < 200; i += 1) {
        expect(shouldFileUncaughtException(signature)).toBe(false);
      }
    });

    it('still files a genuinely different failure while one is repeating', () => {
      expect(shouldFileUncaughtException('TypeError: x is not a function')).toBe(true);
      expect(shouldFileUncaughtException('TypeError: x is not a function')).toBe(false);
      expect(shouldFileUncaughtException('RangeError: invalid array length')).toBe(true);
    });

    it('bounds distinct signatures so a loop with a varying message cannot grow without limit', () => {
      let filed = 0;
      for (let i = 0; i < 500; i += 1) {
        if (shouldFileUncaughtException(`Error at offset ${i}`)) filed += 1;
      }
      expect(filed).toBeLessThanOrEqual(50);
    });
  });
});
