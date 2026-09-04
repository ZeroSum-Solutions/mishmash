import { describe, expect, it } from 'vitest';

import {
  RUN_FAILURE_RECHECK_MAX_MISSES,
  nextInferredRunFailureStep,
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

  it('tolerates a few probes that answer nothing, then stops', () => {
    expect(nextInferredRunFailureStep(null, 0)).toBe('retry');
    expect(nextInferredRunFailureStep(null, RUN_FAILURE_RECHECK_MAX_MISSES - 1)).toBe('retry');
    expect(nextInferredRunFailureStep(null, RUN_FAILURE_RECHECK_MAX_MISSES)).toBe('stop');
    expect(nextInferredRunFailureStep(undefined, RUN_FAILURE_RECHECK_MAX_MISSES)).toBe('stop');
  });
});
