import { describe, expect, it } from 'vitest';
import { resolveFinishedModelIdForAnalytics } from '../../src/routes/runs.js';

// C1-5: the run_finished PostHog event's model_id must record the RESOLVED
// model, not the raw requested one. The original bug used reqBody.model
// directly whenever it looked "explicit" (any non-empty, non-'default'
// string) -- including an invalid custom model id that resolution silently
// discarded, so a substituted run's telemetry disagreed with what actually
// executed.
describe('resolveFinishedModelIdForAnalytics', () => {
  it('uses the resolved model when one exists', () => {
    const id = resolveFinishedModelIdForAnalytics({
      modelRequested: 'claude-sonnet-4-5',
      model: 'claude-sonnet-4-5',
      modelReported: 'claude-sonnet-4-5',
    });
    expect(id).toBe('claude-sonnet-4-5');
  });

  it('falls back to the CLI-reported model when resolution deferred to the CLI default', () => {
    const id = resolveFinishedModelIdForAnalytics({
      modelRequested: 'default',
      model: null,
      modelReported: 'claude-cli-own-default-abc123',
    });
    expect(id).toBe('claude-cli-own-default-abc123');
  });

  it('never falls back to the raw requested model even when it looks "explicit" (the original bug)', () => {
    // An invalid custom model id (e.g. containing spaces) fails
    // sanitizeCustomModel and resolveModelForAgent defers to the CLI's own
    // default -- run.model ends up null even though the raw request was a
    // non-empty, non-'default' string. The old `reqBody.model`-based check
    // treated that raw string as "explicit" and used it directly, leaking
    // pre-resolution input into telemetry.
    const id = resolveFinishedModelIdForAnalytics({
      modelRequested: 'custom claude model invalid unresolved',
      model: null,
      modelReported: 'actually-executed-model-xyz',
    });
    expect(id).toBe('actually-executed-model-xyz');
    expect(id).not.toBe('custom claude model invalid unresolved');
  });

  it('falls back to the "default" sentinel when neither resolved nor reported is available', () => {
    const id = resolveFinishedModelIdForAnalytics({
      modelRequested: null,
      model: null,
      modelReported: null,
    });
    expect(id).toBe('default');
  });
});
