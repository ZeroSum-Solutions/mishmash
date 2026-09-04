// @vitest-environment node

// Track 1F.2 follow-up — the daemon's own delivery verdict is durable in
// intent but not in fact.
//
// `scheduleUnattendedDeliveryClassification` (`apps/daemon/src/server.ts`) runs
// `classifyUnattendedRunDelivery` from a `setTimeout` armed at the run's
// terminal event and cleared to fire one `CLIENT_FINALIZE_SETTLE_MS` window
// (15 s) later. Both the window and the `unref()` on that timer are deliberate:
// the window lets an attached client write its richer verdict first, and the
// unref keeps a pending timer from holding the daemon open. Together they leave
// a 15-second window after every successful turn in which the daemon's verdict
// exists nowhere but in memory.
//
// A daemon exit inside that window drops it. Startup reconciliation does not
// bring it back: `reconcileDurableRunTerminals`
// (`apps/daemon/src/runtimes/run-terminal-reconciliation.ts`) repairs run
// statuses and replays PostHog and Langfuse work, and touches no delivery
// column. The row is left with a NULL `result_delivery_state` and NULL file
// lists — the shape `designDeliveryVerificationPending`
// (`apps/web/src/runtime/design-delivery.ts`) reads as still verifying, and
// `isRetryableAssistantTerminalFailure` can read back as a retryable failure.
//
// This spec drives a delivering design turn at the daemon HTTP boundary with no
// web client attached, kills the daemon inside the settle window, starts it
// again on the same data root, and asserts the turn still ends classified with
// its file list.

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

// The fake codex runtime writes `index.html` and `plan.md` straight into the
// project directory for this prompt and then reports success
// (`e2e/lib/fake-agents.ts` `emitPlanArtifactGenerateRun`).
const DELIVERING_PROMPT = 'Generate the deterministic artifact from the plan document';

// `CLIENT_FINALIZE_SETTLE_MS` in `apps/daemon/src/server.ts`. Mirrored rather
// than imported: `e2e/` must not reach into an app's private source. The
// restart has to complete inside this window or it is not the defect — the
// timer would already have fired and written the verdict.
const CLIENT_FINALIZE_SETTLE_MS = 15_000;

// After the restart the daemon has one boot to record the verdict. Generous
// enough that a slow boot is not read as a lost classification.
const POST_RESTART_TIMEOUT_MS = 45_000;

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
  const deadline = Date.now() + POST_RESTART_TIMEOUT_MS;
  let row = await readAssistantRow(webUrl, projectId, conversationId, assistantMessageId);
  while (Date.now() < deadline) {
    if (row.resultDeliveryState) return row;
    await delay(1000);
    row = await readAssistantRow(webUrl, projectId, conversationId, assistantMessageId);
  }
  return row;
}

describe('dialog unattended delivery survives a daemon restart', () => {
  test('a daemon restart between a run terminal and its delivery timer still leaves the turn classified', async () => {
    const suite = await createSmokeSuite('dialog-unattended-delivery-restart');

    await suite.with.toolsDev(async (context) => {
      const fakeAgents = await createFakeAgentRuntimes({
        root: join(suite.scratchDir, 'fake-agents'),
        runtimeIds: ['codex'],
      });

      await requestJson<{ config: Record<string, unknown> }>(context.webUrl, '/api/app-config', {
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

      const project = await requestJson<ProjectResponse>(context.webUrl, '/api/projects', {
        body: {
          designSystemId: null,
          id: randomUUID(),
          metadata: { kind: 'prototype' },
          name: 'Dialog unattended delivery restart project',
          pendingPrompt: null,
          skillId: null,
        },
      });
      const projectId = project.project.id;
      const conversationId = project.conversationId;

      const startedAt = Date.now();
      const userMessageId = `user-restart-${startedAt}`;
      const assistantMessageId = `assistant-restart-${startedAt}`;
      await saveMessage(context.webUrl, projectId, conversationId, {
        content: DELIVERING_PROMPT,
        createdAt: startedAt,
        id: userMessageId,
        role: 'user',
      });
      // The row exactly as the chat persists it before the stream starts: a
      // design turn, running, with no delivery state and no file list yet.
      await saveMessage(context.webUrl, projectId, conversationId, {
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

      const run = await startRun(context.webUrl, {
        agentId: 'codex',
        assistantMessageId,
        clientRequestId: `req-restart-${startedAt}`,
        conversationId,
        designSystemId: null,
        message: DELIVERING_PROMPT,
        model: 'default',
        projectId,
        reasoning: 'default',
        sessionMode: 'design',
        skillId: null,
      });

      const finalRun = await waitForRunTerminal(context.webUrl, run.runId, { timeoutMs: 90_000 });
      expect(finalRun.status, 'run reached its succeeded terminal event').toBe('succeeded');

      // Precondition: the turn really did deliver work. The agent wrote the
      // files itself, so this is the project's own state, not a seeded fixture.
      const files = await requestJson<{ files: Array<{ name: string }> }>(
        context.webUrl,
        `/api/projects/${encodeURIComponent(projectId)}/files`,
      );
      expect(
        files.files.map((f) => f.name),
        'precondition: the turn wrote index.html into the project',
      ).toContain('index.html');

      // Precondition: nothing has classified the turn yet, so what survives the
      // restart is the daemon's own pending verdict and not an earlier write.
      const beforeRestart = await readAssistantRow(
        context.webUrl,
        projectId,
        conversationId,
        assistantMessageId,
      );
      expect(
        beforeRestart.resultDeliveryState ?? null,
        'precondition: the turn is still unclassified when the daemon goes down',
      ).toBeNull();

      const restart = await context.restart();
      // `finalRun.updatedAt` is the daemon's own terminal clock. If the daemon
      // outlived the settle window the timer already wrote the verdict and this
      // run proves nothing about durability.
      expect(
        restart.stoppedAt - finalRun.updatedAt,
        'the daemon went down inside the client-finalize settle window',
      ).toBeLessThan(CLIENT_FINALIZE_SETTLE_MS);

      const assistant = await waitForClassifiedRow(
        restart.webUrl,
        projectId,
        conversationId,
        assistantMessageId,
      );

      expect(
        assistant.resultDeliveryState,
        'the delivery verdict survives a daemon exit inside the settle window',
      ).toBe('delivered');

      const producedNames = Array.isArray(assistant.producedFiles)
        ? (assistant.producedFiles as Array<{ name?: unknown }>).map((f) => f?.name)
        : null;
      expect(
        producedNames,
        'the produced-file list survives the restart instead of staying null',
      ).not.toBeNull();
      expect(
        producedNames,
        'the produced-file list names the file the turn wrote',
      ).toContain('index.html');
    });
  }, 300_000);
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
