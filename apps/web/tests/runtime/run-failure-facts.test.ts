import { describe, expect, it } from 'vitest';

import { describeRunFailureFacts } from '../../src/runtime/run-failure-facts';

describe('describeRunFailureFacts', () => {
  it('names every lifecycle step the daemon can stop in', () => {
    const stages = [
      'preflight',
      'spawn',
      'session_init',
      'model_select',
      'prompt_send',
      'first_token_wait',
      'tool_execution',
      'artifact_write',
      'child_close',
      'finalize',
    ];
    const keys = new Set<string>();
    for (const stage of stages) {
      const facts = describeRunFailureFacts({ failureStage: stage });
      expect(facts.stage).toBe(stage);
      expect(facts.stepKey).toBeTruthy();
      keys.add(facts.stepKey!);
    }
    // Each step gets its own sentence — a shared key would hide which step
    // actually stopped.
    expect(keys.size).toBe(stages.length);
  });

  it('picks singular and plural file copy off the count', () => {
    expect(describeRunFailureFacts({ artifactCount: 0 }).filesKey)
      .toBe('chat.runError.filesUnchanged');
    expect(describeRunFailureFacts({ artifactCount: 1 }).filesKey)
      .toBe('chat.runError.filesChangedOne');
    expect(describeRunFailureFacts({ artifactCount: 4 }).filesKey)
      .toBe('chat.runError.filesChangedMany');
  });

  it('stays silent rather than guessing when the daemon reported nothing', () => {
    // An older daemon sends neither field. Claiming "no files were changed"
    // there would be a false reassurance, which is worse than saying nothing.
    const facts = describeRunFailureFacts({});
    expect(facts.stage).toBeNull();
    expect(facts.stepKey).toBeNull();
    expect(facts.artifactCount).toBeNull();
    expect(facts.filesKey).toBeNull();
  });

  // W1I.2 — the typed unknown. A restart-interrupted run whose surviving
  // evidence cannot decide whether files changed carries an explicit
  // `fileChangeState: 'unknown'` instead of an absent count, and the alert owes
  // the user its own sentence rather than silence.
  it('names the unknown state when the daemon could not tell whether files changed', () => {
    const facts = describeRunFailureFacts({ fileChangeState: 'unknown' });
    expect(facts.artifactCount).toBeNull();
    expect(facts.filesKey).toBe('chat.runError.filesUnknown');
  });

  it('keeps a measured count over the state word that accompanies it', () => {
    // A measurement is the richer fact: 'unchanged'/'changed' only says which
    // way it fell. The count still picks the sentence, exactly as it does for a
    // live failure that carries no state word at all.
    expect(describeRunFailureFacts({ artifactCount: 0, fileChangeState: 'unchanged' }).filesKey)
      .toBe('chat.runError.filesUnchanged');
    expect(describeRunFailureFacts({ artifactCount: 3, fileChangeState: 'changed' }).filesKey)
      .toBe('chat.runError.filesChangedMany');
  });

  it('rejects a file-change state it does not know', () => {
    expect(describeRunFailureFacts({ fileChangeState: 'not_a_state' }).filesKey).toBeNull();
  });

  it('rejects a stage or count it cannot trust', () => {
    expect(describeRunFailureFacts({ failureStage: 'not_a_stage' }).stepKey).toBeNull();
    expect(describeRunFailureFacts({ artifactCount: -1 }).filesKey).toBeNull();
    expect(describeRunFailureFacts({ artifactCount: 1.5 }).filesKey).toBeNull();
  });
});
