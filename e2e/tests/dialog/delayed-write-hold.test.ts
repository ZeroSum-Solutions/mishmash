// @vitest-environment node

// Wave 1 fix round 2, track W1G.2 — two delayed-write holes that reopen the
// false-failure class the wave bar exists to close: no "Task failed" for a turn
// that succeeded.
//
// Both live on the one client write path,
// `PUT /api/projects/:id/conversations/:cid/messages/:mid`
// (`apps/daemon/src/routes/project/conversations.ts:196`), which calls
// `holdTerminalRunStatusOnMessageWrite`
// (`apps/daemon/src/runtimes/run-terminal-reconciliation.ts:202`) and then
// `upsertMessage` (`apps/daemon/src/db.ts:1609`).
//
// 1. RUN IDENTITY. The hold returns any write naming a different run unchanged
//    before it ever asks which run the write speaks for. `upsertMessage` then
//    replaces `run_id`, `run_status`, `content` and both timestamps with
//    whatever that write carried, and `pinAssistantMessageOnRunCreate`
//    (`apps/daemon/src/runtimes/chat-run-messages.ts:320`) has already made the
//    stored `run_id` the CURRENT run. So a dropped client that flushes a copy
//    naming an OLDER run drags a succeeded retry back to failed on a row the
//    retry owns.
//
// 2. DELIVERY. The hold protects status, timestamp and sometimes the body, and
//    every delivery field passes straight through. `upsertMessage` rewrites
//    `result_delivery_state`, `produced_files_json`, `trace_object_files_json`
//    and `pre_turn_file_names_json` unconditionally, writing NULL for anything
//    the write omits. So a delayed same-run PUT replaces the daemon's
//    `delivered` verdict (`apps/daemon/src/runtimes/
//    run-delivery-classification.ts`) with a stale `no_result` and empties the
//    file lists — and `isRetryableAssistantTerminalFailure`
//    (`apps/web/src/runtime/design-delivery.ts:104`) reads exactly that
//    `no_result` to put the retry alert back in front of the user.
//
// Both cases drive the real daemon HTTP boundary with no web client attached,
// which is the cheapest layer that can see either symptom (`AGENTS.md:310`).

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { createFakeAgentRuntimes } from '@/fake-agents';
import { requestJson } from '@/vitest/http';
import { listMessages, saveMessage, type E2eChatMessage } from '@/vitest/messages';
import { startRun, waitForRunTerminal } from '@/vitest/runs';
import { createSmokeSuite } from '@/vitest/suite';

type ProjectResponse = {
  conversationId: string;
  project: { id: string; metadata?: { kind?: string }; name: string };
};

const SMOKE_PROMPT = 'Create a deterministic smoke artifact';

// The fake codex runtime writes `index.html` and `plan.md` into the project for
// this prompt and then reports success (`e2e/lib/fake-agents.ts`), which is the
// delivery the daemon's own classification has to be able to see.
const DELIVERING_PROMPT = 'Generate the deterministic artifact from the plan document';

// The daemon classifies an unattended turn one settle window after its terminal
// event (`CLIENT_FINALIZE_SETTLE_MS`, `apps/daemon/src/server.ts`), so give the
// poll comfortably more than that before declaring the row unclassified.
const CLASSIFICATION_TIMEOUT_MS = 60_000;

async function configureFakeCodex(webUrl: string, scratchDir: string): Promise<void> {
  const fakeAgents = await createFakeAgentRuntimes({
    root: join(scratchDir, 'fake-agents'),
    runtimeIds: ['codex'],
  });
  await requestJson<{ config: Record<string, unknown> }>(webUrl, '/api/app-config', {
    body: {
      agentCliEnv: { codex: fakeAgents.codex.env },
      agentId: 'codex',
      agentModels: { codex: { model: 'default', reasoning: 'default' } },
      designSystemId: null,
      onboardingCompleted: true,
      skillId: null,
      telemetry: { artifactManifest: true, content: false, metrics: false },
    },
    method: 'PUT',
  });
}

async function createProject(webUrl: string, name: string): Promise<{
  conversationId: string;
  projectId: string;
}> {
  const project = await requestJson<ProjectResponse>(webUrl, '/api/projects', {
    body: {
      designSystemId: null,
      id: randomUUID(),
      metadata: { kind: 'prototype' },
      name,
      pendingPrompt: null,
      skillId: null,
    },
  });
  return { conversationId: project.conversationId, projectId: project.project.id };
}

async function readAssistantRow(
  webUrl: string,
  projectId: string,
  conversationId: string,
  assistantMessageId: string,
): Promise<E2eChatMessage> {
  const allMessages = await listMessages(webUrl, projectId, conversationId);
  const assistant = allMessages.find((m) => m.id === assistantMessageId);
  expect(assistant, 'assistant message present').toBeDefined();
  return assistant!;
}

// Poll until the daemon has recorded a delivery classification, or the budget
// expires. Returns the last row read either way, so the assertion that follows
// reports the actual stored state rather than a bare timeout.
async function waitForClassifiedRow(
  webUrl: string,
  projectId: string,
  conversationId: string,
  assistantMessageId: string,
): Promise<E2eChatMessage> {
  const deadline = Date.now() + CLASSIFICATION_TIMEOUT_MS;
  let row = await readAssistantRow(webUrl, projectId, conversationId, assistantMessageId);
  while (Date.now() < deadline) {
    if (row.resultDeliveryState) return row;
    await delay(1000);
    row = await readAssistantRow(webUrl, projectId, conversationId, assistantMessageId);
  }
  return row;
}

function producedFileNames(row: E2eChatMessage): unknown[] | null {
  return Array.isArray(row.producedFiles)
    ? (row.producedFiles as Array<{ name?: unknown }>).map((file) => file?.name)
    : null;
}

describe('dialog delayed write hold', () => {
  test('a delayed write naming the previous run cannot take a row a succeeded retry owns', async () => {
    const suite = await createSmokeSuite('dialog-delayed-write-older-run');

    await suite.with.toolsDev(async ({ webUrl }) => {
      await configureFakeCodex(webUrl, suite.scratchDir);
      const { conversationId, projectId } = await createProject(
        webUrl,
        'Dialog delayed write, older run',
      );

      const startedAt = Date.now();
      const assistantMessageId = `assistant-older-run-${startedAt}`;
      await saveMessage(webUrl, projectId, conversationId, {
        content: SMOKE_PROMPT,
        createdAt: startedAt,
        id: `user-older-run-${startedAt}`,
        role: 'user',
      });
      // The row exactly as the chat persists it before the stream starts.
      await saveMessage(webUrl, projectId, conversationId, {
        agentId: 'codex',
        agentName: 'Codex',
        content: '',
        createdAt: startedAt,
        events: [],
        id: assistantMessageId,
        role: 'assistant',
        runStatus: 'running',
        startedAt,
      });

      // ---- Attempt 1. The turn runs; one client loses its stream and gives up.
      const firstRun = await startRun(webUrl, {
        agentId: 'codex',
        assistantMessageId,
        clientRequestId: `req-older-run-1-${startedAt}`,
        conversationId,
        designSystemId: null,
        message: SMOKE_PROMPT,
        model: 'default',
        projectId,
        reasoning: 'default',
        skillId: null,
      });
      const firstTerminal = await waitForRunTerminal(webUrl, firstRun.runId, { timeoutMs: 90_000 });
      expect(firstTerminal.status, 'first attempt reached a terminal event').toBe('succeeded');

      // The copy the dropped client holds: the turn as it looked when that
      // client gave up on it — failed, no answer, naming the run it watched.
      // It is not sent yet; a retried PUT, a queued offline write or a second
      // tab flushes it at the end of this test.
      const droppedClientCopy: E2eChatMessage = {
        agentId: 'codex',
        agentName: 'Codex',
        content: '',
        createdAt: startedAt,
        endedAt: Date.now(),
        events: [
          {
            detail: 'Run interrupted because the daemon restarted.',
            kind: 'status',
            label: 'error',
          },
        ],
        id: assistantMessageId,
        role: 'assistant',
        runId: firstRun.runId,
        runStatus: 'failed',
        startedAt,
      };

      // ---- Attempt 2. The user retries on the SAME row, so the new run takes
      // it over through the daemon's own run-create pin.
      await delay(50);
      const retryStartedAt = Date.now();
      const retryRun = await startRun(webUrl, {
        agentId: 'codex',
        assistantMessageId,
        clientRequestId: `req-older-run-2-${retryStartedAt}`,
        conversationId,
        designSystemId: null,
        message: SMOKE_PROMPT,
        model: 'default',
        projectId,
        reasoning: 'default',
        skillId: null,
      });
      expect(retryRun.runId, 'the retry is a new run').not.toBe(firstRun.runId);
      const retryTerminal = await waitForRunTerminal(webUrl, retryRun.runId, { timeoutMs: 90_000 });
      expect(retryTerminal.status, 'the retry reached its succeeded terminal event').toBe('succeeded');

      // The retry's own client saves its answer, the way the chat's onDone
      // handler does.
      const retryAnswer = 'The retried turn delivered this answer.';
      await saveMessage(webUrl, projectId, conversationId, {
        agentId: 'codex',
        agentName: 'Codex',
        content: retryAnswer,
        createdAt: startedAt,
        endedAt: Date.now(),
        events: [],
        id: assistantMessageId,
        role: 'assistant',
        runId: retryRun.runId,
        runStatus: 'succeeded',
        startedAt: retryStartedAt,
      });

      const beforeStaleWrite = await readAssistantRow(
        webUrl,
        projectId,
        conversationId,
        assistantMessageId,
      );
      expect(
        { content: beforeStaleWrite.content, runId: beforeStaleWrite.runId, runStatus: beforeStaleWrite.runStatus },
        'precondition: the retry owns the row and it carries the retry answer',
      ).toEqual({ content: retryAnswer, runId: retryRun.runId, runStatus: 'succeeded' });

      // ---- The delayed write. It names the FIRST run, which no longer owns
      // this row. Nothing in the daemon revisits the row after a client PUT, so
      // the write itself must not be able to unseat the run that does.
      await saveMessage(webUrl, projectId, conversationId, droppedClientCopy);

      const afterStaleWrite = await readAssistantRow(
        webUrl,
        projectId,
        conversationId,
        assistantMessageId,
      );
      expect(
        afterStaleWrite.runStatus,
        'a write naming the previous run must not drag the succeeded retry back to failed',
      ).toBe('succeeded');
      expect(
        afterStaleWrite.content,
        'a write naming the previous run must not blank the retry answer',
      ).toBe(retryAnswer);
      expect(
        afterStaleWrite.runId,
        'the row stays pinned to the run that owns it',
      ).toBe(retryRun.runId);
    });
  }, 240_000);

  test('a delayed same-run write cannot clear the daemon delivery state or its file list', async () => {
    const suite = await createSmokeSuite('dialog-delayed-write-delivery');

    await suite.with.toolsDev(async ({ webUrl }) => {
      await configureFakeCodex(webUrl, suite.scratchDir);
      const { conversationId, projectId } = await createProject(
        webUrl,
        'Dialog delayed write, delivery state',
      );

      const startedAt = Date.now();
      const assistantMessageId = `assistant-delivery-${startedAt}`;
      await saveMessage(webUrl, projectId, conversationId, {
        content: DELIVERING_PROMPT,
        createdAt: startedAt,
        id: `user-delivery-${startedAt}`,
        role: 'user',
      });
      // A design turn, running, with no delivery state and no file list yet —
      // the row as the chat persists it before the stream starts.
      await saveMessage(webUrl, projectId, conversationId, {
        agentId: 'codex',
        agentName: 'Codex',
        content: '',
        createdAt: startedAt,
        events: [],
        id: assistantMessageId,
        role: 'assistant',
        runStatus: 'running',
        sessionMode: 'design',
        startedAt,
      });

      const run = await startRun(webUrl, {
        agentId: 'codex',
        assistantMessageId,
        clientRequestId: `req-delivery-${startedAt}`,
        conversationId,
        designSystemId: null,
        message: DELIVERING_PROMPT,
        model: 'default',
        projectId,
        reasoning: 'default',
        sessionMode: 'design',
        skillId: null,
      });
      const finalRun = await waitForRunTerminal(webUrl, run.runId, { timeoutMs: 90_000 });
      expect(finalRun.status, 'run reached its succeeded terminal event').toBe('succeeded');

      // Precondition: the daemon reached its own delivery verdict for a turn no
      // client was watching, and recorded the file the turn wrote.
      const classified = await waitForClassifiedRow(
        webUrl,
        projectId,
        conversationId,
        assistantMessageId,
      );
      expect(
        classified.resultDeliveryState,
        'precondition: the daemon classified the unattended turn as delivered',
      ).toBe('delivered');
      expect(
        producedFileNames(classified),
        'precondition: the daemon recorded the file the turn wrote',
      ).toContain('index.html');

      // The delayed write. The dropped client made this copy of the turn before
      // the daemon classified it: it saw no delivery of its own, so it carries
      // `no_result` and no file list at all. It names the SAME run, so run
      // identity cannot tell it apart from the row's own live save.
      await saveMessage(webUrl, projectId, conversationId, {
        agentId: 'codex',
        agentName: 'Codex',
        content: '',
        createdAt: startedAt,
        endedAt: Date.now(),
        events: [],
        id: assistantMessageId,
        resultDeliveryState: 'no_result',
        role: 'assistant',
        runId: run.runId,
        runStatus: 'succeeded',
        sessionMode: 'design',
        startedAt,
      });

      const afterStaleWrite = await readAssistantRow(
        webUrl,
        projectId,
        conversationId,
        assistantMessageId,
      );
      // `no_result` is what `isRetryableAssistantTerminalFailure`
      // (`apps/web/src/runtime/design-delivery.ts:104`) reads to show the turn
      // as a retryable terminal failure, so this assertion is the failure
      // surface itself, not a proxy for it.
      expect(
        afterStaleWrite.resultDeliveryState,
        'a delayed client write must not take back the daemon delivered verdict',
      ).toBe('delivered');
      expect(
        producedFileNames(afterStaleWrite),
        'a delayed client write must not empty the daemon-recorded file list',
      ).toContain('index.html');
    });
  }, 240_000);
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
