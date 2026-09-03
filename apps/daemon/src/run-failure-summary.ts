import type { ChatRunStatusResponse, RunFailureStage } from '@open-design/contracts';

// Sentence naming the lifecycle step a run stopped in. Mirrors the web alert's
// `chat.runError.step.*` copy (apps/web/src/runtime/run-failure-facts.ts) so the
// two surfaces name the same step in the same words.
const RUN_FAILURE_STEP_TEXT: Record<RunFailureStage, string> = {
  preflight: 'before the agent started, during preflight checks',
  spawn: 'while starting the agent',
  session_init: 'while opening the agent session',
  model_select: 'while selecting the model',
  prompt_send: 'while sending the prompt',
  first_token_wait: 'while waiting for the first response',
  tool_execution: 'while the agent was running a tool',
  artifact_write: 'while writing files',
  child_close: 'while the agent was responding',
  finalize: 'while finishing the run',
};

const NOT_REPORTED = 'not reported';

/**
 * The four facts a failure alert owes the user, as `od run info` prints them:
 * the step that stopped, the cause, whether files changed, and how to resume.
 *
 * Invariant: every line is present for every terminal run. A fact the daemon
 * did not report reads "not reported" rather than being omitted or guessed —
 * an embedding agent parsing this output must be able to tell "no files were
 * changed" apart from "nobody counted".
 */
export function formatRunFailureSummary(
  status: Partial<ChatRunStatusResponse> | null | undefined,
): string[] {
  const stage = status?.failureStage;
  const step = stage && stage in RUN_FAILURE_STEP_TEXT
    ? `Failed ${RUN_FAILURE_STEP_TEXT[stage as RunFailureStage]}.`
    : NOT_REPORTED;
  const cause = status?.failureDetail ?? status?.errorCode ?? NOT_REPORTED;
  const category = status?.failureCategory ? ` (${status.failureCategory})` : '';
  const files = status?.artifactCount;
  const lines = [
    `run\t${status?.id ?? '-'}\t${status?.status ?? '-'}`,
    `step\t${step}`,
    `cause\t${cause}${category}`,
  ];
  if (status?.error) lines.push(`message\t${String(status.error).split('\n')[0]}`);
  lines.push(
    `files\t${
      typeof files !== 'number'
        ? NOT_REPORTED
        : files === 0
          ? 'no files were changed'
          : `${files} file(s) were changed and kept`
    }`,
    `resume\t${
      status?.resumable === true
        ? `od run continue ${status?.id ?? '<runId>'}`
        : 'not resumable — re-send the turn to start a fresh run'
    }`,
  );
  return lines;
}
