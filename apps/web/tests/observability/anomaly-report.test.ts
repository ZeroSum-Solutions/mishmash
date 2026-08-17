import { describe, expect, it } from 'vitest';

import { anomalyForSafetyEvent } from '../../src/observability/anomaly-report';

// The anomaly log is only skimmable if it holds failures. These assertions pin
// the allowlist in both directions: the failure events must map, and the
// normal-operation events must NOT — a log that fills with healthy records is a
// log nobody can read for the unhealthy ones.

describe('safety event → anomaly mapping', () => {
  it('maps a long task to UI lag and states the measured duration', () => {
    const anomaly = anomalyForSafetyEvent('client_long_task', {
      duration_ms: 620,
      container_name: 'preview-frame',
    });

    expect(anomaly?.kind).toBe('ui-lag');
    expect(anomaly?.severity).toBe('warn');
    expect(anomaly?.summary).toContain('620ms');
    expect(anomaly?.summary).toContain('preview-frame');
  });

  it('maps a white screen to an error, since the user saw nothing at all', () => {
    const anomaly = anomalyForSafetyEvent('client_white_screen', {
      timeout_ms: 8000,
      ready_state: 'complete',
      body_child_count: 1,
    });

    expect(anomaly?.kind).toBe('white-screen');
    expect(anomaly?.severity).toBe('error');
    expect(anomaly?.summary).toContain('8000ms');
  });

  it('maps a failed sub-resource and names the url that failed', () => {
    const anomaly = anomalyForSafetyEvent('client_resource_error', {
      tag: 'script',
      url: 'https://cdn.example.com/chunk.js',
    });

    expect(anomaly?.kind).toBe('resource-failed');
    expect(anomaly?.summary).toContain('https://cdn.example.com/chunk.js');
    expect(anomaly?.summary).toContain('script');
  });

  it('maps both preview iframe failures to preview-error', () => {
    expect(anomalyForSafetyEvent('client_iframe_error', {})?.kind).toBe('preview-error');
    expect(anomalyForSafetyEvent('client_iframe_timeout', { timeout_ms: 15000 })?.kind).toBe(
      'preview-error',
    );
  });

  it('maps a stuck run to an error and carries its run id through', () => {
    const anomaly = anomalyForSafetyEvent('client_run_stuck', {
      run_id: 'run-42',
      duration_since_last_progress_ms: 95_000,
      duration_since_start_ms: 140_000,
    });

    expect(anomaly?.kind).toBe('run-stuck');
    expect(anomaly?.severity).toBe('error');
    expect(anomaly?.runId).toBe('run-42');
    expect(anomaly?.summary).toContain('95.0s');
  });

  it('does not treat normal-operation events as anomalies', () => {
    expect(anomalyForSafetyEvent('client_boot_timing', { total_ms: 900 })).toBeNull();
    expect(anomalyForSafetyEvent('client_visibility_change', { state: 'hidden' })).toBeNull();
    expect(anomalyForSafetyEvent('client_session_summary', {})).toBeNull();
    // A run RECOVERING is the good outcome; the client_run_stuck that preceded
    // it is the record worth keeping.
    expect(anomalyForSafetyEvent('client_run_unstuck', { run_id: 'run-42' })).toBeNull();
    expect(anomalyForSafetyEvent('some_event_added_later', {})).toBeNull();
  });

  it('keeps the originating event name in the detail so a record is traceable', () => {
    const anomaly = anomalyForSafetyEvent('client_long_task', { duration_ms: 120 });

    expect(anomaly?.detail?.safetyEvent).toBe('client_long_task');
    expect(anomaly?.detail?.duration_ms).toBe(120);
  });

  it('summarises without throwing when the expected properties are absent', () => {
    // Probes evolve; a missing property must degrade the summary, not break the
    // report and lose the anomaly entirely.
    for (const event of [
      'client_long_task',
      'client_white_screen',
      'client_resource_error',
      'client_iframe_timeout',
      'client_run_stuck',
    ]) {
      const anomaly = anomalyForSafetyEvent(event, {});
      expect(anomaly).not.toBeNull();
      expect(typeof anomaly?.summary).toBe('string');
      expect(anomaly?.summary.length).toBeGreaterThan(0);
    }
  });
});
