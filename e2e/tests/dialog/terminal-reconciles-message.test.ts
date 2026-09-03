// @vitest-environment node

// Issue #159 section A — "Task failed" for a turn that finished and wrote files.
//
// Symptom from the issue: assistant message rows sit at `failed` with empty
// content next to a run that succeeded. In the live data root, 9 assistant rows
// are `failed` with empty content; 7 of their runs carry a terminal
// `end: succeeded` event and a durable `state.json` with `status: "succeeded"`.
// Six of those rows carry exactly one error event — "Run interrupted because
// the daemon restarted." — which is the daemon's own startup reconciliation
// (`runtimes/run-terminal-reconciliation.ts`) writing `failed` onto a row while
// the run it belongs to was still in flight. Run 2dc3d689 is the clearest case:
// the row was stamped `failed` 2s after the run started, and the run went on to
// emit `end: succeeded` 53s later. Nothing ever revisits the row, because the
// startup reconciliation only looks at rows in `queued`/`running`.
//
// This spec exercises the daemon contract the fix must hold: the message row
// follows the run's TERMINAL event. A row that was marked `failed` with empty
// content while the run was still running must be reconciled to the run's
// terminal status once that terminal event lands — it must never stay `failed`
// with empty content beside a succeeded run.

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { createFakeAgentRuntimes } from '@/fake-agents';
import { requestJson } from '@/vitest/http';
import { listMessages, saveMessage } from '@/vitest/messages';
import { startRun, waitForRunStatus, waitForRunTerminal } from '@/vitest/runs';
import { createSmokeSuite } from '@/vitest/suite';

type ProjectResponse = {
  conversationId: string;
  project: { id: string; metadata?: { kind?: string }; name: string };
};

// The fake codex runtime holds this turn open for ~15s before it succeeds
// (`e2e/lib/fake-agents.ts`), which is the window this spec needs to write the
// bad row while the run is genuinely still in flight.
const SLOW_PROMPT = 'Create a slow reload deterministic smoke artifact';

describe('dialog run terminal reconciles message', () => {
  test('a message marked failed mid-run follows the run terminal event instead of staying failed with empty content', async () => {
    const suite = await createSmokeSuite('dialog-terminal-reconciles-message');

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
          name: 'Dialog terminal reconciles project',
          pendingPrompt: null,
          skillId: null,
        },
      });
      const projectId = project.project.id;
      const conversationId = project.conversationId;

      const startedAt = Date.now();
      const userMessageId = `user-terminal-reconcile-${startedAt}`;
      const assistantMessageId = `assistant-terminal-reconcile-${startedAt}`;
      await saveMessage(webUrl, projectId, conversationId, {
        content: SLOW_PROMPT,
        createdAt: startedAt,
        id: userMessageId,
        role: 'user',
      });
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

      const run = await startRun(webUrl, {
        agentId: 'codex',
        assistantMessageId,
        clientRequestId: `req-${startedAt}`,
        conversationId,
        designSystemId: null,
        message: SLOW_PROMPT,
        model: 'default',
        projectId,
        reasoning: 'default',
        skillId: null,
      });

      // Wait until the daemon reports the run as actually running, so the bad
      // write below is ordered strictly BEFORE the run's terminal event rather
      // than racing it.
      await waitForRunStatus(webUrl, run.runId, 'running', { timeoutMs: 30_000 });

      // Reproduce the stuck row exactly as it appears in the live data root:
      // `failed`, empty content, one "daemon restarted" error event, an
      // endedAt in the past — written while the run is still in flight.
      await saveMessage(webUrl, projectId, conversationId, {
        agentId: 'codex',
        agentName: 'Codex',
        content: '',
        createdAt: startedAt,
        endedAt: Date.now(),
        events: [
          { detail: 'antigravity', kind: 'status', label: 'starting' },
          {
            detail: 'Run interrupted because the daemon restarted.',
            kind: 'status',
            label: 'error',
          },
        ],
        id: assistantMessageId,
        role: 'assistant',
        runId: run.runId,
        runStatus: 'failed',
        startedAt,
      });

      const finalRun = await waitForRunTerminal(webUrl, run.runId, { timeoutMs: 60_000 });
      expect(finalRun.status, 'run reached its succeeded terminal event').toBe('succeeded');

      // Give the terminal reconciliation a brief moment to flush. No web client
      // is attached in this suite, so nothing but the daemon can repair the row.
      await delay(500);

      const allMessages = await listMessages(webUrl, projectId, conversationId);
      const assistant = allMessages.find((m) => m.id === assistantMessageId);
      expect(assistant, 'assistant message present').toBeDefined();

      const content = typeof assistant!.content === 'string' ? assistant!.content.trim() : '';
      expect(
        { content, runStatus: assistant!.runStatus },
        'assistant row must not stay failed with empty content beside a succeeded run',
      ).not.toEqual({ content: '', runStatus: 'failed' });
      expect(assistant!.runStatus, 'assistant row follows the run terminal event').toBe('succeeded');
    });
  }, 180_000);
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
