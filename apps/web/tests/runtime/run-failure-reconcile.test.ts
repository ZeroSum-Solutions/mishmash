import { describe, expect, it } from 'vitest';

import { createGenericDaemonDisconnectError } from '../../src/providers/daemon';
import {
  RUN_FAILURE_RECHECK_INTERVAL_MS,
  RUN_FAILURE_RECHECK_MAX_MISSES,
  applyRunTerminalFromStatus,
  isUnadjudicatedStreamFailure,
  markStreamUnadjudicated,
  nextInferredRunFailureStep,
  retractsRunFailure,
  runCheckWithDaemonReachability,
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
  it('settles on a non-failed terminal', () => {
    expect(nextInferredRunFailureStep('succeeded', 0)).toBe('settle');
    expect(nextInferredRunFailureStep('canceled', 0)).toBe('settle');
  });

  // W1I.1 renames the old `'stop'`: an unresolved stream failure paints nothing,
  // so the run's own `failed` is the step that ADOPTS the daemon verdict rather
  // than the step that leaves an already-painted alert standing.
  it('adopts the daemon verdict when the run really did fail', () => {
    expect(nextInferredRunFailureStep('failed', 0)).toBe('fail');
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

describe('applyRunTerminalFromStatus — the run own terminal, before any read', () => {
  const shown = [assistant({ id: 'msg-1', runId: 'run-1', runStatus: 'failed', endedAt: 10 })];
  const succeeded = { status: 'succeeded' as const, updatedAt: 42 };

  it('moves the failed row onto the terminal the run reports', () => {
    const next = applyRunTerminalFromStatus(shown, 'run-1', succeeded);
    expect(next?.[0]?.runStatus).toBe('succeeded');
    expect(next?.[0]?.endedAt).toBe(42);
  });

  it('does not mutate the rows it was given', () => {
    applyRunTerminalFromStatus(shown, 'run-1', succeeded);
    expect(shown[0]?.runStatus).toBe('failed');
    expect(shown[0]?.endedAt).toBe(10);
  });

  it('keeps the row own endedAt when the status carries no clock', () => {
    expect(applyRunTerminalFromStatus(shown, 'run-1', { status: 'canceled' })?.[0]?.endedAt).toBe(10);
  });

  it('retracts nothing while the run is still going, or when it really failed', () => {
    expect(applyRunTerminalFromStatus(shown, 'run-1', { status: 'running', updatedAt: 42 })).toBeNull();
    expect(applyRunTerminalFromStatus(shown, 'run-1', { status: 'failed', updatedAt: 42 })).toBeNull();
  });

  it('retracts nothing when the probe answered nothing at all', () => {
    expect(applyRunTerminalFromStatus(shown, 'run-1', null)).toBeNull();
    expect(applyRunTerminalFromStatus(shown, 'run-1', undefined)).toBeNull();
  });

  it('leaves rows belonging to another run alone', () => {
    expect(applyRunTerminalFromStatus(shown, 'run-2', succeeded)).toBeNull();
  });

  // W1I.1: an unresolved stream failure leaves the row on its last ACTIVE
  // status instead of stamping it `failed`, so the run's own terminal has to
  // move a row that is still running rather than one that is already failing.
  it('moves a row still shown as running onto the terminal the run reports', () => {
    const running = [assistant({ id: 'msg-1', runId: 'run-1', runStatus: 'running' })];
    const next = applyRunTerminalFromStatus(running, 'run-1', succeeded);
    expect(next?.[0]?.runStatus).toBe('succeeded');
    expect(next?.[0]?.endedAt).toBe(42);
  });

  it('moves a row still shown as queued onto the terminal the run reports', () => {
    const queued = [assistant({ id: 'msg-1', runId: 'run-1', runStatus: 'queued' })];
    expect(applyRunTerminalFromStatus(queued, 'run-1', succeeded)?.[0]?.runStatus).toBe('succeeded');
  });

  it('leaves a row that already settled on its own terminal alone', () => {
    const settled = [assistant({ id: 'msg-1', runId: 'run-1', runStatus: 'succeeded', endedAt: 10 })];
    expect(applyRunTerminalFromStatus(settled, 'run-1', succeeded)).toBeNull();
  });

  it('ignores a user row that happens to carry the run id', () => {
    const userRow = [
      { ...assistant({ id: 'msg-1', runId: 'run-1', runStatus: 'running' }), role: 'user' } as ChatMessage,
    ];
    expect(applyRunTerminalFromStatus(userRow, 'run-1', succeeded)).toBeNull();
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
    expect(applyRunTerminalFromStatus(delivery, 'run-1', succeeded)).toBeNull();
  });
});

// W1I.1 — which stream errors are the daemon's verdict on the run, and which
// this client only inferred from a broken transport.
describe('isUnadjudicatedStreamFailure — a verdict is still a verdict', () => {
  it('reads a non-OK event-stream response as unresolved', () => {
    // `consumeDaemonRun` surfaces exactly this text for a stream answered
    // non-OK, and marks it because it minted the error itself.
    expect(isUnadjudicatedStreamFailure(markStreamUnadjudicated(new Error('daemon 503: no body'))))
      .toBe(true);
  });

  it('reads a transport failure as unresolved', () => {
    expect(isUnadjudicatedStreamFailure(markStreamUnadjudicated(new TypeError('Failed to fetch'))))
      .toBe(true);
  });

  it('reads a stream that closed without a terminal as unresolved', () => {
    // The generic disconnect carries a code, but it is minted by this client
    // after its own reconnect budget ran out — the daemon said nothing.
    expect(isUnadjudicatedStreamFailure(createGenericDaemonDisconnectError())).toBe(true);
  });

  it('keeps the mark off the enumerable shape of the error', () => {
    const marked = markStreamUnadjudicated(new Error('daemon 503: no body'));
    expect(Object.keys(marked)).toEqual([]);
    expect(JSON.parse(JSON.stringify({ ...marked }))).toEqual({});
  });

  it('reads a daemon-classified failure as a verdict', () => {
    const classified = Object.assign(new Error('agent exited with code 1'), {
      failureCategory: 'process_exit',
      failureDetail: 'stream_error',
      failureStage: 'child_close',
    });
    expect(isUnadjudicatedStreamFailure(classified)).toBe(false);
  });

  // The distinction the mark exists for: a daemon `error` frame with no code
  // reads exactly like a transport failure, and is the daemon's verdict.
  it('reads an unmarked daemon error frame as a verdict, code or no code', () => {
    expect(isUnadjudicatedStreamFailure(new Error('daemon error'))).toBe(false);
    const coded = Object.assign(new Error('daemon error'), { code: 'AGENT_EXECUTION_FAILED' });
    expect(isUnadjudicatedStreamFailure(coded)).toBe(false);
  });

  it('reads the restart verdict as a verdict, so it keeps the card', () => {
    const restarted = Object.assign(new Error('Run interrupted because the daemon restarted.'), {
      code: 'DAEMON_RESTARTED',
    });
    expect(isUnadjudicatedStreamFailure(restarted)).toBe(false);
  });

  it('says nothing about a value that is not an error at all', () => {
    expect(isUnadjudicatedStreamFailure(null)).toBe(false);
    expect(isUnadjudicatedStreamFailure(undefined)).toBe(false);
    expect(isUnadjudicatedStreamFailure('daemon 503')).toBe(false);
  });
});

// W1I.1 — the notice's wording follows the DAEMON, not the run.
describe('runCheckWithDaemonReachability — a daemon that answers is not silent', () => {
  const checking = { runId: 'run-1', unreachable: false } as const;
  const unreachable = { runId: 'run-1', unreachable: true } as const;

  it('says the daemon is not answering once nothing has answered', () => {
    expect(runCheckWithDaemonReachability(checking, 'run-1', false)).toEqual(unreachable);
  });

  // The bug this closes: after the probes were exhausted the wording stood even
  // while the daemon answered every later probe, offering "Check again" for a
  // daemon that was demonstrably reachable.
  it('retires that wording the moment anything answers', () => {
    expect(runCheckWithDaemonReachability(unreachable, 'run-1', true)).toEqual(checking);
  });

  it('is a no-op when the wording is already right, so a pane may call it on every probe', () => {
    expect(runCheckWithDaemonReachability(checking, 'run-1', true)).toBe(checking);
    expect(runCheckWithDaemonReachability(unreachable, 'run-1', false)).toBe(unreachable);
  });

  it('leaves another run notice alone, and has nothing to say with no notice', () => {
    expect(runCheckWithDaemonReachability(checking, 'run-2', false)).toBe(checking);
    expect(runCheckWithDaemonReachability(null, 'run-1', false)).toBeNull();
  });

  it('carries the rest of the pane own marker through', () => {
    const carried = { runId: 'run-1', unreachable: false, message: 'daemon 503: no body' };
    expect(runCheckWithDaemonReachability(carried, 'run-1', false))
      .toEqual({ ...carried, unreachable: true });
  });
});
