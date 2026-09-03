import type { RunFailureStage } from '@open-design/contracts';

// The two facts a failure alert owes the user besides the cause: which step
// stopped, and whether their files changed. Kept next to `amr-guidance.ts` (the
// cause half) so the alert's whole contract reads from one place.

export type RunFailureStepKey =
  | 'chat.runError.step.preflight'
  | 'chat.runError.step.spawn'
  | 'chat.runError.step.sessionInit'
  | 'chat.runError.step.modelSelect'
  | 'chat.runError.step.promptSend'
  | 'chat.runError.step.firstTokenWait'
  | 'chat.runError.step.toolExecution'
  | 'chat.runError.step.artifactWrite'
  | 'chat.runError.step.childClose'
  | 'chat.runError.step.finalize';

export type RunFailureFilesKey =
  | 'chat.runError.filesUnchanged'
  | 'chat.runError.filesChangedOne'
  | 'chat.runError.filesChangedMany';

/**
 * Every lifecycle step the daemon can stop in has a sentence naming it.
 *
 * `failureStage` is a closed union owned by `packages/contracts`. Typing this
 * map as a TOTAL `Record` over it means a new step cannot be added upstream
 * without this file naming it, so the alert can never show a step the user
 * cannot read.
 */
const RUN_FAILURE_STEP_BY_STAGE: Record<RunFailureStage, RunFailureStepKey> = {
  preflight: 'chat.runError.step.preflight',
  spawn: 'chat.runError.step.spawn',
  session_init: 'chat.runError.step.sessionInit',
  model_select: 'chat.runError.step.modelSelect',
  prompt_send: 'chat.runError.step.promptSend',
  first_token_wait: 'chat.runError.step.firstTokenWait',
  tool_execution: 'chat.runError.step.toolExecution',
  artifact_write: 'chat.runError.step.artifactWrite',
  child_close: 'chat.runError.step.childClose',
  finalize: 'chat.runError.step.finalize',
};

export interface RunFailureFacts {
  /** Raw stage id, for the alert's `data-run-failure-step` marker. Null when
   *  the daemon reported no stage (an older daemon, or a non-run failure). */
  stage: RunFailureStage | null;
  stepKey: RunFailureStepKey | null;
  /** Files this run created or modified before it failed. Null when the daemon
   *  never resolved a count, in which case the alert stays silent rather than
   *  claiming nothing changed. */
  artifactCount: number | null;
  filesKey: RunFailureFilesKey | null;
}

/**
 * Read the step and file-change facts a failed run's error event carries.
 *
 * A missing field yields `null` rather than a guess: an alert that stated "no
 * files were changed" on a daemon that never told us would be worse than an
 * alert that says nothing about files at all.
 */
export function describeRunFailureFacts(input: {
  failureStage?: string | null;
  artifactCount?: number | null;
}): RunFailureFacts {
  const stage =
    typeof input.failureStage === 'string'
    && input.failureStage in RUN_FAILURE_STEP_BY_STAGE
      ? input.failureStage as RunFailureStage
      : null;
  const artifactCount =
    typeof input.artifactCount === 'number'
    && Number.isInteger(input.artifactCount)
    && input.artifactCount >= 0
      ? input.artifactCount
      : null;
  return {
    stage,
    stepKey: stage ? RUN_FAILURE_STEP_BY_STAGE[stage] : null,
    artifactCount,
    filesKey:
      artifactCount === null
        ? null
        : artifactCount === 0
          ? 'chat.runError.filesUnchanged'
          : artifactCount === 1
            ? 'chat.runError.filesChangedOne'
            : 'chat.runError.filesChangedMany',
  };
}
