import { describe, expect, it, vi } from 'vitest';

import {
  _resetFatalTelemetryHandlersForTests,
  installFatalTelemetryHandlers,
} from '../src/routes/telemetry.js';

describe('fatal telemetry process-listener lifecycle', () => {
  it('shares one process handler pair across server registrations', () => {
    const baselineUncaught = process.listenerCount('uncaughtException');
    const baselineRejection = process.listenerCount('unhandledRejection');
    const analyticsService = {
      captureSafety: vi.fn(async () => undefined),
      shutdown: vi.fn(async () => undefined),
    };

    const cleanupFirst = installFatalTelemetryHandlers({
      analyticsService: analyticsService as never,
      getAppVersion: () => ({ version: '1.0.0' }),
    });
    const cleanupSecond = installFatalTelemetryHandlers({
      analyticsService: analyticsService as never,
      getAppVersion: () => ({ version: '1.0.0' }),
    });

    expect(process.listenerCount('uncaughtException')).toBe(baselineUncaught + 1);
    expect(process.listenerCount('unhandledRejection')).toBe(baselineRejection + 1);

    cleanupFirst();
    cleanupFirst();
    cleanupSecond();
    expect(process.listenerCount('uncaughtException')).toBe(baselineUncaught + 1);
    expect(process.listenerCount('unhandledRejection')).toBe(baselineRejection + 1);

    _resetFatalTelemetryHandlersForTests();
    expect(process.listenerCount('uncaughtException')).toBe(baselineUncaught);
    expect(process.listenerCount('unhandledRejection')).toBe(baselineRejection);
  });
});
