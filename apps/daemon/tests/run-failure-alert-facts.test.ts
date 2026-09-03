import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';
import { SHUTDOWN_INTERRUPTED_MESSAGE } from '../src/runtimes/runs.js';

// W1F.4 red spec — the producer half.
//
// The failure alert owes the user three facts: the cause, the lifecycle step
// that stopped, and whether their files changed. All three travel from the
// daemon to the chat on ONE carrier: the `status:error` event stored on the
// assistant message. This file proves that carrier for every failure the team
// daemon actually reported, by driving a real daemon with a fake agent CLI that
// emits only the raw agent output and then reading the result back through the
// production HTTP API a reload uses.
//
// Nothing here is pre-injected. Every category / detail / stage / artifact
// count asserted below is resolved by the daemon's own classifier from the
// agent output in AGENT_OUTPUT, which is copied verbatim from the run log:
//
//   63fc304f  the agent stalled and the inactivity watchdog ended the turn
//   7557ed43  the machine slept mid-response
//   0291fa4d  the configured custom Anthropic endpoint refused the connection
//   578cbce8  the user denied a write_file permission prompt
//   (quota)   the provider refused the request for exceeded quota
//
// plus the two cancellations, which are NOT the same event: a Stop the user
// pressed must stay silent, and a shutdown that ended the turn for them must
// name itself.
//
// The consumer half — which user-facing sentence each of these renders — is
// `apps/web/tests/components/ChatPane.failure-alert.test.tsx` and
// `e2e/ui/run-failure-alert-causes.test.ts`.

type StartedServer = {
  url: string;
  server: Server;
  shutdown?: () => Promise<void> | void;
};

type RunStatus = {
  id: string;
  status: string;
  error?: string | null;
  errorCode?: string | null;
  failureCategory?: string | null;
  failureDetail?: string | null;
  failureStage?: string | null;
  artifactCount?: number;
};

type PersistedEvent = {
  kind?: string;
  label?: string;
  detail?: string;
  code?: string;
  failureCategory?: string;
  failureDetail?: string;
  failureStage?: string;
  artifactCount?: number;
};

type StoredMessage = { id: string; role: string; events?: PersistedEvent[] };

// The closed failure-stage union from packages/contracts, spelled out so a
// stage the daemon invents outside it fails these specs.
const FAILURE_STAGES = [
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

// `SHUTDOWN_INTERRUPTED_MESSAGE` is imported from the daemon rather than
// restated here, so this spec cannot agree with a copy of the sentence that
// production no longer sends. The consumer spec's SHUTDOWN_CANCEL_RUN fixture
// mirrors it by hand — `apps/web` may not import daemon source (AGENTS.md,
// Boundary constraints) — which is why this spec pins every field of the
// persisted event, including the sentence.

/** Verbatim agent output from the reported runs. See the file header. */
const AGENT_OUTPUT = {
  sleep: 'API Error: Your computer went to sleep mid-response. The response above may be incomplete.',
  endpointDown: 'Error: connect ECONNREFUSED 127.0.0.1:1',
  quota: 'API Error: You have exceeded your current quota. Please upgrade your plan to continue.',
  deniedPermission:
    'Error: permission check failed for write_file "index.html": user denied permission for write_file(index.html)',
} as const;

describe('a failed or cancelled run carries its cause, step and file-change state to the chat', () => {
  const originalEnv = snapshotEnv();
  let started: StartedServer | null = null;
  let binDir: string | null = null;

  afterEach(async () => {
    await Promise.resolve(started?.shutdown?.());
    if (started?.server) {
      await new Promise<void>((resolve) => started?.server.close(() => resolve()));
    }
    started = null;
    if (binDir) await removeTempDir(binDir);
    binDir = null;
    restoreEnv(originalEnv);
  });

  it.each([
    [
      'the machine slept mid-response',
      'Return the reported sleep-drop failure',
      AGENT_OUTPUT.sleep,
      'stdout',
      { failureCategory: 'process_exit', failureDetail: 'stream_error', failureStage: 'child_close' },
    ],
    [
      'the configured endpoint refused the connection',
      'Return the reported endpoint-unreachable failure',
      AGENT_OUTPUT.endpointDown,
      'stderr',
      { failureCategory: 'upstream_unavailable', failureDetail: 'network_error', failureStage: 'first_token_wait' },
    ],
    [
      'the provider refused the request for exceeded quota',
      'Return the reported quota failure',
      AGENT_OUTPUT.quota,
      'stdout',
      { failureCategory: 'rate_limit', failureDetail: 'hard_quota', failureStage: 'session_init' },
    ],
    [
      'the user denied a write_file permission prompt',
      'Return the reported denied-permission failure',
      AGENT_OUTPUT.deniedPermission,
      'stderr',
      { failureCategory: 'process_exit', failureDetail: 'permission_denied', failureStage: 'tool_execution' },
    ],
  ])(
    'names the cause, the step and the file-change state when %s',
    async (_label, prompt, output, channel, expected) => {
      binDir = await mkdtemp(path.join(os.tmpdir(), 'od-alert-facts-bin-'));
      const fakeClaude = await writeReplayClaude(binDir, `claude-${channel}-${randomUUID()}`, output, channel);

      started = await startDaemon({
        CLAUDE_BIN: fakeClaude,
        // The refused-endpoint diagnostic only applies when the run really was
        // pointed at a custom endpoint, so the fixture configures one.
        ...(prompt.includes('endpoint-unreachable')
          ? { ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' }
          : {}),
      });

      const { projectId, conversationId } = await createConversation(started.url);
      const run = await sendRunAndWait(started.url, projectId, conversationId, prompt);
      expect(run.status.status, run.status.error ?? '').toBe('failed');

      // The run record names the cause the daemon classified…
      expect(run.status.failureCategory).toBe(expected.failureCategory);
      expect(run.status.failureDetail).toBe(expected.failureDetail);
      expect(FAILURE_STAGES).toContain(run.status.failureStage);
      expect(run.status.failureStage).toBe(expected.failureStage);
      expect(run.status.artifactCount).toBe(0);

      // …and the stored assistant message carries every one of those facts, so
      // a reload renders the same alert the live stream did.
      const errorEvent = await storedErrorEvent(started.url, projectId, conversationId, run.assistantMessageId);
      expect(errorEvent, 'the assistant message must carry a status:error event').toBeTruthy();
      expect(errorEvent?.failureCategory).toBe(expected.failureCategory);
      expect(errorEvent?.failureDetail).toBe(expected.failureDetail);
      expect(errorEvent?.failureStage).toBe(run.status.failureStage);
      expect(errorEvent?.artifactCount).toBe(0);
    },
    60_000,
  );

  it('names an inactivity stall as a timeout, from the daemon watchdog itself', async () => {
    binDir = await mkdtemp(path.join(os.tmpdir(), 'od-alert-facts-bin-'));
    const fakeClaude = await writeSilentClaude(binDir, 'claude-stalls');

    // The real stall is the daemon's own inactivity watchdog ending a turn that
    // stopped emitting. Shortening its window is what makes that reachable in a
    // test; the message, classification and persistence are the production ones.
    process.env.OD_CHAT_RUN_INACTIVITY_TIMEOUT_MS = '1200';
    started = await startDaemon({ CLAUDE_BIN: fakeClaude });

    const { projectId, conversationId } = await createConversation(started.url);
    const run = await sendRunAndWait(
      started.url,
      projectId,
      conversationId,
      'Stall without emitting any further output',
      45_000,
    );
    expect(run.status.status, run.status.error ?? '').toBe('failed');
    expect(run.status.error ?? '').toContain('stalled without emitting any new output');
    expect(run.status.failureCategory).toBe('timeout');
    expect(run.status.failureDetail).toBe('inactivity_timeout');
    expect(FAILURE_STAGES).toContain(run.status.failureStage);

    const errorEvent = await storedErrorEvent(started.url, projectId, conversationId, run.assistantMessageId);
    expect(errorEvent?.failureCategory).toBe('timeout');
    expect(errorEvent?.failureDetail).toBe('inactivity_timeout');
    expect(errorEvent?.failureStage).toBe(run.status.failureStage);
    expect(errorEvent?.artifactCount).toBe(0);
  }, 60_000);

  it('leaves a Stop the user pressed with a named cause on the run and no alert on the message', async () => {
    binDir = await mkdtemp(path.join(os.tmpdir(), 'od-alert-facts-bin-'));
    const fakeClaude = await writeSilentClaude(binDir, 'claude-hangs-user-stop');
    started = await startDaemon({ CLAUDE_BIN: fakeClaude });

    const { projectId, conversationId } = await createConversation(started.url);
    const run = await startRun(started.url, projectId, conversationId, 'Hold the run open until stopped');
    await waitForRunning(started.url, run.runId);

    const cancelResponse = await fetch(
      `${started.url}/api/runs/${encodeURIComponent(run.runId)}/cancel`,
      { method: 'POST' },
    );
    expect(cancelResponse.status).toBe(200);
    const status = await waitForRun(started.url, run.runId);

    expect(status.status).toBe('canceled');
    expect(status.failureCategory).toBe('user_cancel');
    expect(status.failureDetail).toBe('user_cancelled');
    expect(FAILURE_STAGES).toContain(status.failureStage);

    // The user pressed Stop, so they already know why the turn ended. Painting
    // a failure alert over their own action is the regression this guards.
    const errorEvent = await storedErrorEvent(
      started.url,
      projectId,
      conversationId,
      run.assistantMessageId,
    );
    expect(errorEvent).toBeUndefined();
  }, 60_000);

  it('names a turn the daemon shutdown ended, on the message as well as the run', async () => {
    binDir = await mkdtemp(path.join(os.tmpdir(), 'od-alert-facts-bin-'));
    const fakeClaude = await writeSilentClaude(binDir, 'claude-hangs-shutdown');
    started = await startDaemon({ CLAUDE_BIN: fakeClaude });

    const { projectId, conversationId } = await createConversation(started.url);
    const run = await startRun(started.url, projectId, conversationId, 'Hold the run open until shutdown');
    await waitForRunning(started.url, run.runId);

    // Shut the daemon down under the in-flight turn — the shutdownActive path,
    // not POST /cancel. Nobody stopped this turn; it was taken from the user.
    const url = started.url;
    await Promise.resolve(started.shutdown?.());

    const status = await fetchRunStatus(url, run.runId);
    expect(status?.status).toBe('canceled');
    expect(status?.failureCategory).toBe('process_exit');
    expect(status?.failureDetail).toBe('interrupted');
    expect(status?.failureDetail).not.toBe('user_cancelled');

    // …and unlike a user Stop, this one MUST reach the chat: the user did not
    // do it and has no other way to learn why their turn ended.
    const errorEvent = await storedErrorEvent(url, projectId, conversationId, run.assistantMessageId);
    expect(
      errorEvent,
      'a shutdown-ended turn must carry a status:error event naming its cause',
    ).toBeTruthy();
    expect(errorEvent?.failureCategory).toBe('process_exit');
    expect(errorEvent?.failureDetail).toBe('interrupted');
    expect(FAILURE_STAGES).toContain(errorEvent?.failureStage);
    // Pinned, not merely a member of the union: the consumer spec's
    // SHUTDOWN_CANCEL_RUN fixture claims to mirror this event exactly, and a
    // field only asserted to be "some valid stage" would leave that claim
    // unchecked for this one field.
    expect(errorEvent?.failureStage).toBe('first_token_wait');
    expect(status?.failureStage).toBe('first_token_wait');
    expect(errorEvent?.artifactCount).toBe(0);
    // The classification alone is not an explanation. Without a sentence on the
    // event the chat has nothing to render under the title and `od run info`
    // prints no message, so the turn is still silent to the user.
    expect(errorEvent?.detail, 'the event must say in words why the turn ended').toBe(
      SHUTDOWN_INTERRUPTED_MESSAGE,
    );
    expect(status?.error).toBe(SHUTDOWN_INTERRUPTED_MESSAGE);
  }, 60_000);
});

function snapshotEnv(): Record<string, string | undefined> {
  return {
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL,
    OPEN_DESIGN_TELEMETRY_RELAY_URL: process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL,
    POSTHOG_KEY: process.env.POSTHOG_KEY,
    POSTHOG_HOST: process.env.POSTHOG_HOST,
    OD_CHAT_RUN_INACTIVITY_TIMEOUT_MS: process.env.OD_CHAT_RUN_INACTIVITY_TIMEOUT_MS,
  };
}

function restoreEnv(env: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function startDaemon(claudeEnv: Record<string, string>): Promise<StartedServer> {
  delete process.env.POSTHOG_KEY;
  delete process.env.POSTHOG_HOST;
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  delete process.env.LANGFUSE_BASE_URL;
  delete process.env.OPEN_DESIGN_TELEMETRY_RELAY_URL;
  const server = (await startServer({ port: 0, returnServer: true })) as StartedServer;
  await putConfig(server.url, {
    agentId: 'claude',
    agentCliEnv: { claude: claudeEnv },
    telemetry: { metrics: true, content: false, artifactManifest: false },
    privacyDecisionAt: Date.now(),
  });
  return server;
}

/**
 * A fake Claude CLI that replays one captured failure on the channel the real
 * CLI used for it, then exits non-zero. Provider API refusals arrive on stdout
 * as a synthetic assistant block plus an is_error result frame; local failures
 * arrive on stderr.
 */
async function writeReplayClaude(
  dir: string,
  name: string,
  message: string,
  channel: string,
): Promise<string> {
  const bin = path.join(dir, name);
  const body = channel === 'stdout'
    ? `console.log(JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-alert-facts' }));
console.log(JSON.stringify({ type: 'assistant', message: { id: 'msg-1', model: '<synthetic>', role: 'assistant', stop_reason: 'stop_sequence', content: [{ type: 'text', text: MESSAGE }] }, error: 'unknown' }));
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: MESSAGE, stop_reason: 'stop_sequence', duration_ms: 1, total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 } }));`
    : `console.log(JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-alert-facts' }));
process.stderr.write(MESSAGE + '\\n');`;
  await writeFile(
    bin,
    `#!/usr/bin/env node
const MESSAGE = ${JSON.stringify(message)};
if (process.argv.includes('--version')) { console.log('claude-code 1.0.0-alert-facts'); process.exit(0); }
if (process.argv.includes('--help')) { console.log('Usage: claude -p [--include-partial-messages]'); process.exit(0); }
${body}
setTimeout(() => process.exit(1), 20);
`,
    'utf8',
  );
  await chmod(bin, 0o755);
  return bin;
}

/** A fake Claude CLI that starts its session and then emits nothing, ever. */
async function writeSilentClaude(dir: string, name: string): Promise<string> {
  const bin = path.join(dir, name);
  await writeFile(
    bin,
    `#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('claude-code 1.0.0-silent'); process.exit(0); }
if (process.argv.includes('--help')) { console.log('Usage: claude -p [--include-partial-messages]'); process.exit(0); }
console.log(JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-silent' }));
setInterval(() => {}, 1000);
`,
    'utf8',
  );
  await chmod(bin, 0o755);
  return bin;
}

async function putConfig(url: string, patch: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${url}/api/app-config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  expect(response.status).toBe(200);
}

async function createConversation(
  url: string,
): Promise<{ projectId: string; conversationId: string }> {
  const projectId = `alert_facts_${randomUUID()}`;
  const response = await fetch(`${url}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: projectId,
      name: 'Run failure alert facts',
      metadata: { kind: 'prototype' },
      skipDiscoveryBrief: true,
    }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { conversationId: string };
  return { projectId, conversationId: body.conversationId };
}

async function startRun(
  url: string,
  projectId: string,
  conversationId: string,
  message: string,
): Promise<{ runId: string; assistantMessageId: string }> {
  const assistantMessageId = `assistant_alert_facts_${randomUUID()}`;
  const response = await fetch(`${url}/api/runs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-od-analytics-device-id': 'alert-facts-test',
      'x-od-analytics-session-id': 'alert-facts-session',
      'x-od-analytics-client-type': 'web',
    },
    body: JSON.stringify({
      projectId,
      conversationId,
      assistantMessageId,
      clientRequestId: `client_alert_facts_${randomUUID()}`,
      agentId: 'claude',
      message,
      currentPrompt: message,
    }),
  });
  expect(response.status).toBe(202);
  const body = (await response.json()) as { runId: string };
  return { runId: body.runId, assistantMessageId };
}

async function sendRunAndWait(
  url: string,
  projectId: string,
  conversationId: string,
  message: string,
  timeoutMs = 15_000,
): Promise<{ assistantMessageId: string; status: RunStatus }> {
  const run = await startRun(url, projectId, conversationId, message);
  const status = await waitForRun(url, run.runId, timeoutMs);
  return { assistantMessageId: run.assistantMessageId, status };
}

async function waitForRunning(url: string, runId: string): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    const run = await fetchRunStatus(url, runId);
    if (run && run.status !== 'queued') return;
    await delay(50);
  }
  throw new Error(`run ${runId} never started`);
}

async function fetchRunStatus(url: string, runId: string): Promise<RunStatus | null> {
  const response = await fetch(`${url}/api/runs/${encodeURIComponent(runId)}`).catch(() => null);
  if (!response || !response.ok) return null;
  return (await response.json()) as RunStatus;
}

async function waitForRun(url: string, runId: string, timeoutMs = 15_000): Promise<RunStatus> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(`${url}/api/runs/${encodeURIComponent(runId)}`);
    expect(response.status).toBe(200);
    const run = (await response.json()) as RunStatus;
    if (run.status === 'failed' || run.status === 'succeeded' || run.status === 'canceled') {
      return run;
    }
    await delay(100);
  }
  throw new Error(`run ${runId} did not finish`);
}

/**
 * The stored assistant message's last `status:error` event, read the way a
 * reload reads it: over the production conversation-messages route, not from
 * the live SSE stream.
 */
async function storedErrorEvent(
  url: string,
  projectId: string,
  conversationId: string,
  assistantMessageId: string,
): Promise<PersistedEvent | undefined> {
  const response = await fetch(
    `${url}/api/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { messages?: StoredMessage[] };
  const stored = body.messages?.find((message) => message.id === assistantMessageId);
  return [...(stored?.events ?? [])]
    .reverse()
    .find((event) => event.kind === 'status' && event.label === 'error');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
