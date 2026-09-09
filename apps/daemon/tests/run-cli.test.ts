import { readFileSync } from 'node:fs';
import { dirname, resolve as pathResolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli, startRunStubServer, type StubServer } from './helpers/run-cli-stub';

const __dirname = dirname(fileURLToPath(import.meta.url));

// W7B / INV-7.13 F-02 fixture: one frozen, contracts-shaped terminal `end`
// event, reused by `run-cli-notice.test.ts` and by
// `apps/web/tests/components/ProjectView.notifications.test.tsx`. See
// `fixtures/w7-run/terminal-end-event.json` for the generator note.
const RUN_END_EVENT_FIXTURE = (
  JSON.parse(
    readFileSync(pathResolve(__dirname, 'fixtures/w7-run/terminal-end-event.json'), 'utf8'),
  ) as { event: Record<string, unknown> }
).event;

let stub: StubServer | null = null;

afterEach(async () => {
  if (stub) await stub.close();
  stub = null;
});

describe('od run CLI', () => {
  it('continues a resumable run through the normal run creation API', async () => {
    stub = await startRunStubServer(true);

    const result = await runCli([
      'run',
      'continue',
      'run-1',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('[run] continued run-1 as run-2\n');
    expect(stub.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      'GET /api/runs/run-1',
      'POST /api/runs',
    ]);
    expect(JSON.parse(stub.requests[1]!.body)).toMatchObject({
      projectId: 'project-1',
      conversationId: 'conversation-1',
      agentId: 'claude',
      analyticsHints: { entryFrom: 'resume_continue' },
    });
    expect(JSON.parse(stub.requests[1]!.body).message).toContain(
      'The previous turn was interrupted by a transient failure.',
    );
  });

  // T-05: the native-session resume path is hot (190 `resumed` states in the
  // live run logs) and neither surface said so. `od run info` is where the CLI
  // reports one run's status, so it is where an embedding agent has to be able
  // to read whether the turn continued an existing agent session.
  it('reports the native session recovery state in od run info', async () => {
    stub = await startRunStubServer(false, {
      nativeSessionRecovery: {
        agentId: 'claude',
        state: 'resumed',
        acquisition: 'stream-captured',
        continuation: 'native-resume-by-id',
        handle: { present: true, kind: 'opaque-id', display: null, sha256: null, redacted: true },
        guardReason: null,
        fallbackReason: null,
        updatedAt: 1700000004,
      },
    });

    const result = await runCli(['run', 'info', 'run-1', '--daemon-url', stub.baseUrl]);

    expect(result.code).toBe(0);
    // A failed run leads with the failure summary (step, cause, file-change
    // state, resume) and still ends with the session-recovery line: both
    // surfaces of `od run info` print, and nothing else does.
    expect(result.stdout).toBe([
      'run\trun-1\tfailed',
      'step\tnot reported',
      'cause\tnot reported',
      'files\tnot reported',
      'resume\tnot resumable — re-send the turn to start a fresh run',
      'project\tproject-1\tconversation=conversation-1',
      'agent\tclaude\tresumable=false',
      'session-recovery\tresumed\trecovered=yes\tcontinuation=native-resume-by-id',
      '',
    ].join('\n'));
  });

  it('reports no session recovery for a run that recovered nothing', async () => {
    stub = await startRunStubServer(false, {
      nativeSessionRecovery: {
        agentId: 'claude',
        state: 'no_recoverable_session',
        acquisition: 'none',
        continuation: 'none',
        handle: { present: false, kind: 'unknown', display: null, sha256: null, redacted: true },
        guardReason: 'missing_cursor',
        fallbackReason: null,
        updatedAt: 1700000004,
      },
    });

    const result = await runCli(['run', 'info', 'run-1', '--daemon-url', stub.baseUrl]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('session-recovery\tno_recoverable_session\trecovered=no\tcontinuation=none');
  });

  it('reports a dash when the daemon carries no recovery metadata for the run', async () => {
    stub = await startRunStubServer(false);

    const result = await runCli(['run', 'info', 'run-1', '--daemon-url', stub.baseUrl]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('session-recovery\t-\trecovered=no\tcontinuation=-');
  });

  it('still emits the raw run status document under --json', async () => {
    stub = await startRunStubServer(false, {
      nativeSessionRecovery: {
        agentId: 'claude',
        state: 'resumed',
        acquisition: 'stream-captured',
        continuation: 'native-resume-by-id',
        handle: { present: true, kind: 'opaque-id', display: null, sha256: null, redacted: true },
        guardReason: null,
        fallbackReason: null,
        updatedAt: 1700000004,
      },
    });

    const result = await runCli(['run', 'info', 'run-1', '--daemon-url', stub.baseUrl, '--json']);

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      id: 'run-1',
      nativeSessionRecovery: { continuation: 'native-resume-by-id', state: 'resumed' },
      status: 'failed',
    });
  });

  it('refuses to continue a run without a safe recoverable native session', async () => {
    stub = await startRunStubServer(false);

    const result = await runCli([
      'run',
      'continue',
      'run-1',
      '--daemon-url',
      stub.baseUrl,
    ]);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Run run-1 does not have a safe recoverable native session.');
    expect(stub.requests.map((request) => `${request.method} ${request.url}`)).toEqual([
      'GET /api/runs/run-1',
    ]);
  });

  // W7B / INV-7.15: on the terminal `end` frame, `streamRunEvents` writes
  // exactly one "Run finished: <status>" line to stderr while stdout's
  // ND-JSON stays byte-for-byte unchanged. RED on base: `streamRunEvents`
  // writes nothing to stderr, so `result.stderr` is empty there — a
  // behavioural mismatch, not an import or compile error (the pure
  // `completionNotice` helper's own contract is covered separately in
  // `run-cli-notice.test.ts`, which is new on this branch and not part of
  // this red spec's proof per W7-R2-17).
  it('writes exactly one non-TTY stderr completion notice while stdout ND-JSON stays unchanged', async () => {
    stub = await startRunStubServer(false, {}, RUN_END_EVENT_FIXTURE);

    const result = await runCli(['run', 'watch', 'run-1', '--daemon-url', stub.baseUrl]);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('Run finished: succeeded\n');
    expect(result.stdout).toBe(
      `${JSON.stringify({ event: 'end', data: RUN_END_EVENT_FIXTURE })}\n`,
    );
  });

  it('writes the same non-TTY notice under --json — never a different "why not" message', async () => {
    stub = await startRunStubServer(false, {}, RUN_END_EVENT_FIXTURE);

    const result = await runCli(['run', 'watch', 'run-1', '--daemon-url', stub.baseUrl, '--json']);

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('Run finished: succeeded\n');
    expect(result.stdout).toBe(
      `${JSON.stringify({ event: 'end', data: RUN_END_EVENT_FIXTURE })}\n`,
    );
  });
});
