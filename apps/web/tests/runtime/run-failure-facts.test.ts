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

  it('rejects a stage or count it cannot trust', () => {
    expect(describeRunFailureFacts({ failureStage: 'not_a_stage' }).stepKey).toBeNull();
    expect(describeRunFailureFacts({ artifactCount: -1 }).filesKey).toBeNull();
    expect(describeRunFailureFacts({ artifactCount: 1.5 }).filesKey).toBeNull();
  });
});
