import { describe, expect, it } from 'vitest';
import {
  designDeliveryVerificationPending,
  resolveDesignDeliveryOutcome,
} from '../../src/runtime/design-delivery';
import { latestPreviewRunStatus } from '../../src/runtime/preview-run-status';
import type { ChatMessage } from '../../src/types';

/**
 * The chat's side of the daemon-recorded classification
 * (`apps/daemon/src/runtimes/run-delivery-classification.ts`).
 *
 * A turn nobody had open is classified by the daemon, which writes the delivery
 * state and BOTH file lists onto the row. These cases pin what the chat must do
 * with the three shapes that row can arrive in, because that is what decides
 * whether the user meets a settled turn or the `verifying` phase.
 */
function unattendedRow(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: 'Swapped in the crossed-arms hero and dropped the old draft.',
    sessionMode: 'design',
    runStatus: 'succeeded',
    runId: 'run-1',
    events: [],
    createdAt: 1_000,
    startedAt: 1_000,
    endedAt: 2_000,
    ...overrides,
  } as ChatMessage;
}

describe('design delivery — a turn recorded by the daemon', () => {
  it('is settled once the daemon has written the delivery state', () => {
    const message = unattendedRow({
      resultDeliveryState: 'delivered',
      producedFiles: [],
      traceObjectFiles: [],
    });
    expect(designDeliveryVerificationPending(message)).toBe(false);
    expect(latestPreviewRunStatus([message], 2_100)?.phase).toBe('succeeded');
  });

  // The daemon records BOTH lists for exactly this reason: a report-only turn
  // carries no delivery state, so the file lists are the only thing that can
  // take it out of `verifying`.
  it('is settled for a report-only turn once both file lists are recorded', () => {
    const message = unattendedRow({ producedFiles: [], traceObjectFiles: [] });
    expect(designDeliveryVerificationPending(message)).toBe(false);
    expect(latestPreviewRunStatus([message], 2_100)).toBeNull();
  });

  it('stays verifying while either file list is still missing', () => {
    expect(
      designDeliveryVerificationPending(unattendedRow({ producedFiles: [] })),
    ).toBe(true);
    expect(
      designDeliveryVerificationPending(unattendedRow({ traceObjectFiles: [] })),
    ).toBe(true);
    expect(
      latestPreviewRunStatus([unattendedRow({ producedFiles: [] })], 2_100)?.phase,
    ).toBe('verifying');
  });

  // The daemon reduces its own evidence to the same decision the chat makes.
  // This pins the chat's answer for the shape the daemon reports as delivered:
  // no new file NAME, one project file rewritten inside the run's window.
  it('classifies a turn that only rewrote an existing project file as delivered', () => {
    expect(
      resolveDesignDeliveryOutcome({
        sessionMode: 'design',
        runStatus: 'succeeded',
        content: 'Swapped in the crossed-arms hero and dropped the old draft.',
        events: [],
        producedFileCount: 0,
        traceObjectFileCount: 0,
        modifiedFileCount: 1,
      }),
    ).toBe('delivered');
  });
});
