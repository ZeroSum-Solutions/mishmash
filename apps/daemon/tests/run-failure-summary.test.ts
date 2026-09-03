import { describe, expect, it } from 'vitest';

import { formatRunFailureSummary } from '../src/run-failure-summary.js';

// `od run info <runId>` is the CLI half of the failure alert (AGENTS.md →
// Capability exposure). An embedding agent has no web UI, so the four facts the
// chat card states must also be readable here: the step, the cause, whether
// files changed, and how to resume.

function fieldsOf(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines) {
    const [key, ...rest] = line.split('\t');
    if (key) out[key] = rest.join('\t');
  }
  return out;
}

describe('formatRunFailureSummary', () => {
  it('names the step, the cause, the file-change state, and the resume command', () => {
    // Run 63fc304f from the team daemon's run log: stalled for 600s during a
    // tool call, four files already written, session resumable.
    const fields = fieldsOf(formatRunFailureSummary({
      id: 'run-63fc304f',
      status: 'failed',
      errorCode: 'AGENT_EXECUTION_FAILED',
      failureCategory: 'timeout',
      failureDetail: 'inactivity_timeout',
      failureStage: 'tool_execution',
      artifactCount: 4,
      resumable: true,
      error: 'Agent stalled without emitting any new output for 600s.\nPhase details: …',
    }));

    expect(fields.run).toBe('run-63fc304f\tfailed');
    expect(fields.step).toBe('Failed while the agent was running a tool.');
    expect(fields.cause).toBe('inactivity_timeout (timeout)');
    expect(fields.files).toBe('4 file(s) were changed and kept');
    expect(fields.resume).toBe('od run continue run-63fc304f');
    // Only the first line of a multi-line daemon error, so the summary stays
    // one fact per line for `cut`/`awk` consumers.
    expect(fields.message).toBe('Agent stalled without emitting any new output for 600s.');
  });

  it('says plainly that nothing was written when the run changed no files', () => {
    // Run 0291fa4d: the machine slept mid-response.
    const fields = fieldsOf(formatRunFailureSummary({
      id: 'run-0291fa4d',
      status: 'failed',
      errorCode: 'AGENT_EXECUTION_FAILED',
      failureCategory: 'process_exit',
      failureDetail: 'stream_error',
      failureStage: 'child_close',
      artifactCount: 0,
      resumable: false,
    }));

    expect(fields.step).toBe('Failed while the agent was responding.');
    expect(fields.cause).toBe('stream_error (process_exit)');
    expect(fields.files).toBe('no files were changed');
    expect(fields.resume).toBe('not resumable — re-send the turn to start a fresh run');
  });

  it('distinguishes an unreported fact from a zero count', () => {
    // An older daemon reports neither stage nor artifact count. The summary must
    // not read that as "no files were changed".
    const fields = fieldsOf(formatRunFailureSummary({
      id: 'run-legacy',
      status: 'failed',
      errorCode: 'AGENT_EXECUTION_FAILED',
    }));

    expect(fields.step).toBe('not reported');
    expect(fields.cause).toBe('AGENT_EXECUTION_FAILED');
    expect(fields.files).toBe('not reported');
    // Every line is still present, so a parser never has to handle a missing key.
    expect(Object.keys(fields).sort()).toEqual(['cause', 'files', 'resume', 'run', 'step']);
  });
});
