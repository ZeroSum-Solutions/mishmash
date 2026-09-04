import { describe, expect, it } from 'vitest';

import {
  RUN_FAILURE_RECHECK_INTERVAL_MS,
  RUN_FAILURE_RECHECK_MAX_MISSES,
  nextInferredRunFailureStep,
  retractRunFailureFromStatus,
  retractsRunFailure,
  retractsStaleRunFailure,
} from '../../src/runtime/run-failure-reconcile';
import type { ChatMessage } from '../../src/types';

function assistant(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: 'answer',
    createdAt: 1,
    runId: 'run-1',
    ...overrides,
  } as ChatMessage;
}

describe('retractsRunFailure — one row against the status arriving for it', () => {
  it('retracts when a failed row is told its run succeeded', () => {
    expect(retractsRunFailure(assistant({ runStatus: 'failed' }), 'succeeded')).toBe(true);
  });

  it('retracts when a failed row is told its run is alive again', () => {
    expect(retractsRunFailure(assistant({ runStatus: 'failed' }), 'running')).toBe(true);
  });

  it('keeps the failure when the run is authoritatively failed', () => {
    expect(retractsRunFailure(assistant({ runStatus: 'failed' }), 'failed')).toBe(false);
  });

  it('keeps the failure when the row fails on delivery rather than on run status', () => {
    const row = assistant({ runStatus: 'succeeded', resultDeliveryState: 'no_result' });
    expect(retractsRunFailure(row, 'succeeded')).toBe(false);
  });

  it('has nothing to retract for a row that was not failing, or no row at all', () => {
    expect(retractsRunFailure(assistant({ runStatus: 'succeeded' }), 'succeeded')).toBe(false);
    expect(retractsRunFailure(undefined, 'succeeded')).toBe(false);
  });

  it('ignores a user row', () => {
    const row = { ...assistant({ runStatus: 'failed' }), role: 'user' } as ChatMessage;
    expect(retractsRunFailure(row, 'succeeded')).toBe(false);
  });
});

describe('retractsStaleRunFailure — rows a conversation refresh brings in', () => {
  const shownFailed = [assistant({ id: 'msg-1', runStatus: 'failed' })];

  it('retracts when the incoming row for a failed id is no longer failing', () => {
    const incoming = [assistant({ id: 'msg-1', runStatus: 'succeeded' })];
    expect(retractsStaleRunFailure(shownFailed, incoming)).toBe(true);
  });

  it('keeps the failure when the incoming row is still failed', () => {
    const incoming = [assistant({ id: 'msg-1', runStatus: 'failed' })];
    expect(retractsStaleRunFailure(shownFailed, incoming)).toBe(false);
  });

  it('keeps the failure when the incoming row succeeded but delivered nothing', () => {
    const incoming = [
      assistant({ id: 'msg-1', runStatus: 'succeeded', resultDeliveryState: 'no_result' }),
    ];
    expect(retractsStaleRunFailure(shownFailed, incoming)).toBe(false);
  });

  // `mergeServerMessageWithLocal` keeps the shown row's status when the
  // incoming row carries none, so such a row retracts nothing.
  it('retracts nothing when the incoming row carries no run status of its own', () => {
    const incoming = [assistant({ id: 'msg-1', runStatus: undefined })];
    expect(retractsStaleRunFailure(shownFailed, incoming)).toBe(false);
  });

  it('ignores an unrelated row that happens to be healthy', () => {
    const incoming = [
      assistant({ id: 'msg-1', runStatus: 'failed' }),
      assistant({ id: 'msg-2', runStatus: 'succeeded' }),
    ];
    expect(retractsStaleRunFailure(shownFailed, incoming)).toBe(false);
  });

  it('does nothing when no shown row was failing', () => {
    const shown = [assistant({ id: 'msg-1', runStatus: 'succeeded' })];
    const incoming = [assistant({ id: 'msg-1', runStatus: 'succeeded' })];
    expect(retractsStaleRunFailure(shown, incoming)).toBe(false);
  });
});

describe('nextInferredRunFailureStep — following a run the pane never saw finish', () => {
  it('retracts on a non-failed terminal', () => {
    expect(nextInferredRunFailureStep('succeeded', 0)).toBe('retract');
    expect(nextInferredRunFailureStep('canceled', 0)).toBe('retract');
  });

  it('stops at once when the run really did fail, so a failed row is never re-queried', () => {
    expect(nextInferredRunFailureStep('failed', 0)).toBe('stop');
  });

  // The realistic shape of this defect: the stream fails when it OPENS, at the
  // start of a turn that then runs for seconds or minutes. A pane that looked
  // once and gave up would leave the alert on screen for the whole run.
  it('keeps following while the run is still going', () => {
    expect(nextInferredRunFailureStep('queued', 0)).toBe('retry');
    expect(nextInferredRunFailureStep('running', 0)).toBe('retry');
    expect(nextInferredRunFailureStep('running', RUN_FAILURE_RECHECK_MAX_MISSES + 10)).toBe('retry');
  });

  // Supersedes "tolerates a few probes that answer nothing, then stops", which
  // asserted `'stop'` at a cap of three. Three misses is a nine-second daemon
  // hiccup — the outage class that produces an inferred failure in the first
  // place — so ending the recovery there abandoned it for the very reason it
  // existed.
  it('keeps following through an outage that would have ended the recovery', () => {
    expect(nextInferredRunFailureStep(null, 0)).toBe('retry');
    expect(nextInferredRunFailureStep(null, 3)).toBe('retry');
    expect(nextInferredRunFailureStep(null, RUN_FAILURE_RECHECK_MAX_MISSES - 1)).toBe('retry');
  });

  it('falls back to a conversation read when an unbroken outage exhausts the bound', () => {
    expect(nextInferredRunFailureStep(null, RUN_FAILURE_RECHECK_MAX_MISSES)).toBe('reconcile');
    expect(nextInferredRunFailureStep(undefined, RUN_FAILURE_RECHECK_MAX_MISSES)).toBe('reconcile');
  });

  // The bound is a duration, not a count: it must outlast the hiccup class the
  // recovery exists for. Five minutes of a daemon that never answers.
  it('bounds the outage at five minutes of unanswered probes', () => {
    expect(RUN_FAILURE_RECHECK_MAX_MISSES * RUN_FAILURE_RECHECK_INTERVAL_MS)
      .toBeGreaterThanOrEqual(5 * 60_000);
  });
});

describe('retractRunFailureFromStatus — the run own terminal, before any read', () => {
  const shown = [assistant({ id: 'msg-1', runId: 'run-1', runStatus: 'failed', endedAt: 10 })];
  const succeeded = { status: 'succeeded' as const, updatedAt: 42 };

  it('moves the failed row onto the terminal the run reports', () => {
    const next = retractRunFailureFromStatus(shown, 'run-1', succeeded);
    expect(next?.[0]?.runStatus).toBe('succeeded');
    expect(next?.[0]?.endedAt).toBe(42);
  });

  it('does not mutate the rows it was given', () => {
    retractRunFailureFromStatus(shown, 'run-1', succeeded);
    expect(shown[0]?.runStatus).toBe('failed');
    expect(shown[0]?.endedAt).toBe(10);
  });

  it('keeps the row own endedAt when the status carries no clock', () => {
    expect(retractRunFailureFromStatus(shown, 'run-1', { status: 'canceled' })?.[0]?.endedAt).toBe(10);
  });

  it('retracts nothing while the run is still going, or when it really failed', () => {
    expect(retractRunFailureFromStatus(shown, 'run-1', { status: 'running', updatedAt: 42 })).toBeNull();
    expect(retractRunFailureFromStatus(shown, 'run-1', { status: 'failed', updatedAt: 42 })).toBeNull();
  });

  it('retracts nothing when the probe answered nothing at all', () => {
    expect(retractRunFailureFromStatus(shown, 'run-1', null)).toBeNull();
    expect(retractRunFailureFromStatus(shown, 'run-1', undefined)).toBeNull();
  });

  it('leaves rows belonging to another run alone', () => {
    expect(retractRunFailureFromStatus(shown, 'run-2', succeeded)).toBeNull();
  });

  it('keeps a row that fails on delivery rather than on run status', () => {
    const delivery = [
      assistant({
        id: 'msg-1',
        runId: 'run-1',
        runStatus: 'succeeded',
        resultDeliveryState: 'no_result',
      }),
    ];
    expect(retractRunFailureFromStatus(delivery, 'run-1', succeeded)).toBeNull();
  });
});
