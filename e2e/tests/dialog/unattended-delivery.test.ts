// @vitest-environment node

// Track 1.2 follow-up — the delivery classifier only ever runs inside an
// attached web client.
//
// `resolveDesignDeliveryOutcome` / `applyDesignDeliveryOutcome`
// (`apps/web/src/runtime/design-delivery.ts`) have production callers only in
// `apps/web/src/components/ProjectView.tsx`. The daemon's message writer
// (`apps/daemon/src/db.ts` `upsertMessage`) merely stores whatever a client
// hands it, and writes NULL for `produced_files_json` and
// `result_delivery_state` when a client hands it nothing.
//
// So a design turn that finishes while nobody has the project open is never
// classified at all: the row keeps a null delivery state and a null file list,
// and the chat shows it in the `verifying` phase
// (`apps/web/src/runtime/preview-run-status.ts:89`) forever. In the live data
// root 71 design assistant rows carry a null produced-file list, 11 of them
// with `run_status='succeeded'`, and 68 succeeded design rows carry no
// delivery state at all.
//
// This spec drives the daemon HTTP boundary with NO web client attached — the
// e2e smoke suite starts a tools-dev runtime and talks to it over HTTP only —
// and asserts the contract the fix must hold: a succeeded design turn that
// wrote project files ends with the daemon's own recorded delivery
// classification and file list, exactly as an attended turn would.

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
// (`e2e/lib/fake-agents.ts` `emitPlanArtifactGenerateRun`). That is a design
// turn that delivered work through the agent's own filesystem writes — the
// shape the daemon must be able to classify without a client.
const DELIVERING_PROMPT = 'Generate the deterministic artifact from the plan document';

// The daemon may only classify a turn once it is sure no client will. That
// settle window is the daemon's own client-finalize window
// (`CLIENT_FINALIZE_SETTLE_MS` in `apps/daemon/src/server.ts`), so give the
// poll comfortably more than that before declaring the row unclassified.
const CLASSIFICATION_TIMEOUT_MS = 60_000;

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

describe('dialog unattended delivery classification', () => {
  test('a succeeded design turn with no attached web client is classified and keeps its file list', async () => {
    const suite = await createSmokeSuite('dialog-unattended-delivery');

    await suite.with.toolsDev(async ({ webUrl }) => {
      const fakeAgents = await createFakeAgentRuntimes({
        root: join(suite.scratchDir, 'fake-agents'),
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

      const project = await requestJson<ProjectResponse>(webUrl, '/api/projects', {
        body: {
          designSystemId: null,
          id: randomUUID(),
          metadata: { kind: 'prototype' },
          name: 'Dialog unattended delivery project',
          pendingPrompt: null,
          skillId: null,
        },
      });
      const projectId = project.project.id;
      const conversationId = project.conversationId;

      const startedAt = Date.now();
      const userMessageId = `user-unattended-${startedAt}`;
      const assistantMessageId = `assistant-unattended-${startedAt}`;
      await saveMessage(webUrl, projectId, conversationId, {
        content: DELIVERING_PROMPT,
        createdAt: startedAt,
        id: userMessageId,
        role: 'user',
      });
      // The row exactly as the chat persists it before the stream starts: a
      // design turn, running, with no delivery state and no file list yet.
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
        clientRequestId: `req-unattended-${startedAt}`,
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

      // Precondition: the turn really did deliver work. The agent wrote the
      // files itself, so this is the project's own state, not a seeded fixture.
      const files = await requestJson<{ files: Array<{ name: string }> }>(
        webUrl,
        `/api/projects/${encodeURIComponent(projectId)}/files`,
      );
      expect(
        files.files.map((f) => f.name),
        'precondition: the turn wrote index.html into the project',
      ).toContain('index.html');

      const assistant = await waitForClassifiedRow(
        webUrl,
        projectId,
        conversationId,
        assistantMessageId,
      );

      expect(
        assistant.resultDeliveryState,
        'the daemon records the delivery classification for a turn no client watched',
      ).toBe('delivered');

      const producedNames = Array.isArray(assistant.producedFiles)
        ? (assistant.producedFiles as Array<{ name?: unknown }>).map((f) => f?.name)
        : null;
      expect(
        producedNames,
        'the daemon records the produced-file list instead of writing null',
      ).not.toBeNull();
      expect(
        producedNames,
        'the produced-file list names the file the turn wrote',
      ).toContain('index.html');
    });
  }, 240_000);

  // The harder half of "no attached client": a turn whose assistant row no
  // client ever wrote at all. The chat pre-stamps that row before it starts a
  // run; a caller that only speaks HTTP -- the `od` CLI, an external agent, a
  // routine -- does not, and the daemon creates the row itself on run create
  // (`pinAssistantMessageOnRunCreate`, `apps/daemon/src/runtimes/
  // chat-run-messages.ts`). That row is the one the classification has to be
  // able to claim.
  test('a design turn whose assistant row only the daemon ever wrote is classified too', async () => {
    const suite = await createSmokeSuite('dialog-unattended-delivery-no-row');

    await suite.with.toolsDev(async ({ webUrl }) => {
      const fakeAgents = await createFakeAgentRuntimes({
        root: join(suite.scratchDir, 'fake-agents'),
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

      const project = await requestJson<ProjectResponse>(webUrl, '/api/projects', {
        body: {
          designSystemId: null,
          id: randomUUID(),
          metadata: { kind: 'prototype' },
          name: 'Dialog unattended delivery, daemon-created row',
          pendingPrompt: null,
          skillId: null,
        },
      });
      const projectId = project.project.id;
      const conversationId = project.conversationId;

      const startedAt = Date.now();
      const assistantMessageId = `assistant-daemon-row-${startedAt}`;
      // Nothing is saved for this turn: the run request is the first and only
      // thing this caller sends.
      const run = await startRun(webUrl, {
        agentId: 'codex',
        assistantMessageId,
        clientRequestId: `req-daemon-row-${startedAt}`,
        conversationId,
        designSystemId: null,
        message: DELIVERING_PROMPT,
        model: 'default',
        projectId,
        reasoning: 'default',
        skillId: null,
      });

      const finalRun = await waitForRunTerminal(webUrl, run.runId, { timeoutMs: 90_000 });
      expect(finalRun.status, 'run reached its succeeded terminal event').toBe('succeeded');

      const assistant = await waitForClassifiedRow(
        webUrl,
        projectId,
        conversationId,
        assistantMessageId,
      );

      expect(
        assistant.sessionMode,
        'the daemon stamped the row it created as a design turn',
      ).toBe('design');
      expect(
        assistant.resultDeliveryState,
        'the daemon classifies a turn whose row it created itself',
      ).toBe('delivered');
      const producedNames = Array.isArray(assistant.producedFiles)
        ? (assistant.producedFiles as Array<{ name?: unknown }>).map((f) => f?.name)
        : null;
      expect(
        producedNames,
        'the produced-file list names the file the turn wrote',
      ).toContain('index.html');
    });
  }, 240_000);
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
