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
    expect(nextLostRunCreateStep('run-mine', 1, true)).toBe('adopt');
    expect(nextLostRunCreateStep('run-mine', LOST_RUN_CREATE_MAX_PROBES, true)).toBe('adopt');
    expect(nextLostRunCreateStep('run-mine', LOST_RUN_CREATE_MAX_PROBES + 5, true)).toBe('adopt');
    // A read that did not answer can still have found the run in the surface
    // that did.
    expect(nextLostRunCreateStep('run-mine', 1, false)).toBe('adopt');
  });

  // One probe finding nothing is not evidence that nothing ran; the client
  // keeps looking rather than naming a failure it has not established.
  it('keeps looking while the bound has room', () => {
    for (let probes = 1; probes < LOST_RUN_CREATE_MAX_PROBES; probes += 1) {
      expect(nextLostRunCreateStep(null, probes, true)).toBe('probe');
    }
  });

  it('gives up only once the bound is spent, which is what rules a live run out', () => {
    expect(nextLostRunCreateStep(null, LOST_RUN_CREATE_MAX_PROBES, true)).toBe('abandon');
    expect(nextLostRunCreateStep(null, LOST_RUN_CREATE_MAX_PROBES + 1, true)).toBe('abandon');
  });

  // The B-02 hazard in miniature: the outage that loses a create response is
  // the one that then fails the lookup's own reads, and both reads report a
  // failed request as "nothing here". A probe that could not read has ruled
  // nothing out, so it must never buy the right to offer Retry.
  it('never spends the bound on a probe that could not read', () => {
    expect(nextLostRunCreateStep(null, LOST_RUN_CREATE_MAX_PROBES, false)).toBe('probe');
    expect(nextLostRunCreateStep(null, LOST_RUN_CREATE_MAX_PROBES * 10, false)).toBe('probe');
  });
});

// W1K.2 red spec — a lookup that cannot READ the daemon must eventually SAY so.
//
// An unanswered probe rules nothing out, so it never spends the abandon bound
// and the lookup keeps looking (the case above). That is the right thing to do
// and the wrong thing to show: the row it is looking for keeps the composer's
// Send disabled, so an unbroken read outage leaves a paused conversation behind
// a notice that says only "Checking its result…" and offers no action at all.
//
// So the lookup carries a SECOND bound, counted on the consecutive probes that
// could not read. Reaching it changes nothing about the outcome — never a
// failure, never Retry, still probing — and only changes what the notice says:
// the daemon is not answering, and here is a manual re-check.
//
// The counts below are literals rather than the exported bound so this file
// imports nothing the fix has to add first; the red run must fail on the
// assertion, not on a missing export. Three is the bound
// (`LOST_RUN_CREATE_MAX_UNANSWERED_PROBES`), and asserting on both sides of it
// is what pins it.
const UNANSWERED_UNDER_BOUND = 2;
const UNANSWERED_AT_BOUND = 3;

describe('nextLostRunCreateStep — a daemon that answers nothing at all', () => {
  it('keeps the ordinary checking wording while the unanswered bound has room', () => {
    for (let unanswered = 1; unanswered <= UNANSWERED_UNDER_BOUND; unanswered += 1) {
      expect(nextLostRunCreateStep(null, unanswered, false, unanswered)).toBe('probe');
    }
  });

  it('says the daemon is not answering once the unanswered probes reach the bound', () => {
    expect(nextLostRunCreateStep(null, UNANSWERED_AT_BOUND, false, UNANSWERED_AT_BOUND)).toBe(
      'unreachable',
    );
    expect(nextLostRunCreateStep(null, 40, false, 40)).toBe('unreachable');
  });

  // The B-02 hazard again: the outage that loses a create response is the one
  // that fails the lookup's reads, so a daemon nobody can read must never be
  // read as a run nobody started. Saying so is a WORDING change, not a verdict.
  it('never abandons a lookup that could not read, however long the outage runs', () => {
    for (const unanswered of [UNANSWERED_AT_BOUND, 40, LOST_RUN_CREATE_MAX_PROBES * 100]) {
      expect(nextLostRunCreateStep(null, unanswered, false, unanswered)).not.toBe('abandon');
    }
  });

  // A daemon that is replying to every probe must never be described as silent,
  // so any answer at all retires the wording — the count that reaches the bound
  // is CONSECUTIVE.
  it('takes the wording back the moment a probe answers', () => {
    expect(nextLostRunCreateStep(null, 1, true, 0)).toBe('probe');
    expect(nextLostRunCreateStep('run-mine', 40, false, 40)).toBe('adopt');
  });
});
