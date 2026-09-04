// W1J.2 — the decisions a client makes about a create response it never read.
//
// The daemon creates and pins the run BEFORE it answers the create request and
// starts the turn afterwards (`apps/daemon/src/routes/runs.ts`), so a lost
// response leaves a client holding two ids for a run that may already be
// running. These are the rules that turn those two ids back into a run, and the
// one condition under which naming a failure is honest.

import { describe, expect, it } from 'vitest';
import type { ChatRunStatusResponse } from '@open-design/contracts';
import {
  LOST_RUN_CREATE_MAX_PROBES,
  matchLostRunCreate,
  nextLostRunCreateStep,
  pinnedRunIdForAssistantRow,
} from '../../src/runtime/lost-run-create';
import type { ChatMessage } from '../../src/types';

const IDENTITY = { clientRequestId: 'req-1', assistantMessageId: 'msg-1' };

function run(overrides: Partial<ChatRunStatusResponse>): ChatRunStatusResponse {
  return {
    id: 'run-x',
    projectId: 'proj-1',
    conversationId: 'conv-1',
    assistantMessageId: null,
    clientRequestId: null,
    agentId: 'claude',
    status: 'running',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  } as ChatRunStatusResponse;
}

function assistantRow(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: '',
    createdAt: 1,
    ...overrides,
  } as ChatMessage;
}

describe('matchLostRunCreate — the run this client asked for', () => {
  it('finds the run by the request id the client minted and sent', () => {
    const runs = [run({ id: 'run-other' }), run({ id: 'run-mine', clientRequestId: 'req-1' })];
    expect(matchLostRunCreate(runs, IDENTITY)).toBe('run-mine');
  });

  // The request id is unique to ONE create call; the assistant row can be
  // reused by a retry. So a run carrying the request id wins even when another
  // run claims the same row.
  it('prefers the request id over the assistant row id', () => {
    const runs = [
      run({ id: 'run-retried', assistantMessageId: 'msg-1' }),
      run({ id: 'run-mine', clientRequestId: 'req-1' }),
    ];
    expect(matchLostRunCreate(runs, IDENTITY)).toBe('run-mine');
  });

  it('falls back to the assistant row the daemon pinned', () => {
    const runs = [run({ id: 'run-pinned', assistantMessageId: 'msg-1' })];
    expect(matchLostRunCreate(runs, IDENTITY)).toBe('run-pinned');
  });

  it('claims nothing from a run that carries neither id', () => {
    expect(matchLostRunCreate([run({ id: 'run-someone-else' })], IDENTITY)).toBeNull();
    expect(matchLostRunCreate([], IDENTITY)).toBeNull();
  });
});

describe('pinnedRunIdForAssistantRow — the durable half of the lookup', () => {
  it('reads the run id the daemon stamped on this client own row', () => {
    const messages = [assistantRow({ id: 'msg-0' }), assistantRow({ runId: 'run-pinned' })];
    expect(pinnedRunIdForAssistantRow(messages, 'msg-1')).toBe('run-pinned');
  });

  it('answers nothing for a row with no run stamped on it, and for no row at all', () => {
    expect(pinnedRunIdForAssistantRow([assistantRow({})], 'msg-1')).toBeNull();
    expect(pinnedRunIdForAssistantRow([], 'msg-1')).toBeNull();
  });
});

describe('nextLostRunCreateStep — what the client does with what it found', () => {
  it('adopts a run the moment either id names one, however late', () => {
    expect(nextLostRunCreateStep('run-mine', 1)).toBe('adopt');
    expect(nextLostRunCreateStep('run-mine', LOST_RUN_CREATE_MAX_PROBES)).toBe('adopt');
    expect(nextLostRunCreateStep('run-mine', LOST_RUN_CREATE_MAX_PROBES + 5)).toBe('adopt');
  });

  // One probe finding nothing is not evidence that nothing ran; the client
  // keeps looking rather than naming a failure it has not established.
  it('keeps looking while the bound has room', () => {
    for (let probes = 1; probes < LOST_RUN_CREATE_MAX_PROBES; probes += 1) {
      expect(nextLostRunCreateStep(null, probes)).toBe('probe');
    }
  });

  it('gives up only once the bound is spent, which is what rules a live run out', () => {
    expect(nextLostRunCreateStep(null, LOST_RUN_CREATE_MAX_PROBES)).toBe('abandon');
    expect(nextLostRunCreateStep(null, LOST_RUN_CREATE_MAX_PROBES + 1)).toBe('abandon');
  });
});
