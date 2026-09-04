// @vitest-environment node

// W1H.2 red spec — the daemon half, at the HTTP boundary.
//
// Track 1.4/1F.4 made a failure alert name its cause, the step that stopped,
// and whether the user's files changed, by persisting those facts onto the
// assistant row's `status:error` event
// (`persistRunFailureClassification`, `apps/daemon/src/runtimes/
// chat-run-messages.ts`). One shutdown shape never reached that writer: a
// daemon that died with a turn in flight and so never ran `shutdownActive`.
//
// Such a run is classified at the NEXT boot by `reconcileDurableRunTerminals`
// (`apps/daemon/src/runtimes/run-terminal-reconciliation.ts`), which marks it
// `failed` with `errorCode: 'DAEMON_RESTARTED'` in `state.json` but wrote its
// message event through `appendMessageStatusEvent` — a writer that keeps only
// `label` and `detail` and discards every other key. The stored event therefore
// carried no `code`, no `failureStage` and no `artifactCount`, so a reload
// showed the generic "Task failed" with no step and no file-change line.
//
// This spec drives a real turn that writes a file and then holds, SIGKILLs the
// daemon under it (a hard kill, not the graceful stop `shutdownActive` owns),
// starts the daemon again on the same `OD_DATA_DIR`, and reads the stored
// message back through the messages API — the same bytes the chat renders.

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { createFakeAgentRuntimes } from '@/fake-agents';
import { requestJson } from '@/vitest/http';
import { listMessages, saveMessage, type E2eChatMessage } from '@/vitest/messages';
import { startRun } from '@/vitest/runs';
import { createSmokeSuite } from '@/vitest/suite';

type ProjectResponse = {
  conversationId: string;
  project: { id: string; metadata?: { kind?: string }; name: string };
};

type StoredStatusEvent = {
  kind?: string;
  label?: string;
  detail?: string;
  code?: string;
  failureCategory?: string;
  failureDetail?: string;
  failureStage?: string;
  artifactCount?: number;
};

// The fake claude runtime writes `index.html` through a Write tool_use /
// tool_result pair and then holds the turn open (`e2e/lib/fake-agents.ts`
// `emitClaudeHeldArtifactWriteRun`), so the kill lands on a run that has
// provably done work and has not finished.
const HELD_PROMPT = 'Write the deterministic artifact then hold the daemon run open';

const WRITE_OBSERVED_TIMEOUT_MS = 90_000;
const RECONCILED_TIMEOUT_MS = 60_000;
const DAEMON_GONE_TIMEOUT_MS = 15_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lastErrorEvent(message: E2eChatMessage | undefined): StoredStatusEvent | null {
  const events = Array.isArray(message?.events) ? (message.events as StoredStatusEvent[]) : [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.kind === 'status' && event.label === 'error') return event;
  }
  return null;
}

describe('a daemon restart leaves the same structured failure the live path leaves', () => {
  test('an interrupted run carries the cause, the step and the file-change state after reload', async () => {
    const suite = await createSmokeSuite('dialog-daemon-restart-failure-facts');

    await suite.with.toolsDev(async (context) => {
      const fakeAgents = await createFakeAgentRuntimes({
        root: join(suite.scratchDir, 'fake-agents'),
        runtimeIds: ['claude'],
      });

      await requestJson<{ config: Record<string, unknown> }>(context.webUrl, '/api/app-config', {
        body: {
          agentCliEnv: { claude: fakeAgents.claude.env },
          agentId: 'claude',
          agentModels: { claude: { model: 'default', reasoning: 'default' } },
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
          name: 'Daemon restart failure facts project',
          pendingPrompt: null,
          skillId: null,
        },
      });
      const projectId = project.project.id;
      const conversationId = project.conversationId;

      const startedAt = Date.now();
      const userMessageId = `user-restart-facts-${startedAt}`;
      const assistantMessageId = `assistant-restart-facts-${startedAt}`;
      await saveMessage(context.webUrl, projectId, conversationId, {
        content: HELD_PROMPT,
        createdAt: startedAt,
        id: userMessageId,
        role: 'user',
      });
      await saveMessage(context.webUrl, projectId, conversationId, {
        agentId: 'claude',
        agentName: 'Claude',
        content: '',
        createdAt: startedAt,
        events: [],
        id: assistantMessageId,
        role: 'assistant',
        runStatus: 'running',
        sessionMode: 'design',
        startedAt,
      });

      await startRun(context.webUrl, {
        agentId: 'claude',
        assistantMessageId,
        clientRequestId: `req-restart-facts-${startedAt}`,
        conversationId,
        designSystemId: null,
        message: HELD_PROMPT,
        model: 'default',
        projectId,
        reasoning: 'default',
        sessionMode: 'design',
        skillId: null,
      });

      // Precondition: the turn really wrote a file before the kill, so the
      // file-change fact the alert owes has something true to say.
      const writeDeadline = Date.now() + WRITE_OBSERVED_TIMEOUT_MS;
      let wroteIndexHtml = false;
      while (Date.now() < writeDeadline && !wroteIndexHtml) {
        const files = await requestJson<{ files: Array<{ name: string }> }>(
          context.webUrl,
          `/api/projects/${encodeURIComponent(projectId)}/files`,
        );
        wroteIndexHtml = files.files.some((file) => file.name === 'index.html');
        if (!wroteIndexHtml) await delay(500);
      }
      expect(wroteIndexHtml, 'precondition: the held turn wrote index.html').toBe(true);

      // Precondition: the run is still in flight, so what follows is the
      // interrupted path and not an ordinary terminal failure. Either
      // non-terminal status counts — `reconcileMessages` selects both, and
      // which of the two a row shows depends on how far the chat client's own
      // row bookkeeping got, which no client is doing here.
      const beforeKill = (await listMessages(context.webUrl, projectId, conversationId))
        .find((message) => message.id === assistantMessageId);
      expect(
        ['queued', 'running'],
        'precondition: the turn has not reached a terminal when the daemon dies',
      ).toContain(beforeKill?.runStatus);

      // A hard kill, not `tools-dev stop`: a graceful stop runs the daemon's
      // `shutdownActive`, which cancels live runs through the live failure
      // path. Only SIGKILL leaves a run whose terminal is decided at the next
      // boot, which is the path under test.
      //
      // The whole process GROUP, not the reported pid: `tools-dev` spawns the
      // runtime detached (so the pid it reports leads a new group) and the
      // daemon runs in a re-exec'd child of it. Signalling the leader alone
      // leaves the daemon alive to be stopped gracefully a moment later, which
      // is the other shutdown shape entirely.
      const daemonPid = context.start.daemon?.pid;
      expect(daemonPid, 'the suite exposes the daemon pid to kill').toBeTypeOf('number');
      process.kill(-(daemonPid as number), 'SIGKILL');

      // Precondition: the daemon is really gone before anything restarts it.
      // A daemon that answered here would have had the chance to shut down its
      // own runs, and the spec would be measuring the wrong path.
      const daemonUrl = `http://127.0.0.1:${context.runtime.daemonPort}/api/health`;
      const goneDeadline = Date.now() + DAEMON_GONE_TIMEOUT_MS;
      let daemonGone = false;
      while (Date.now() < goneDeadline && !daemonGone) {
        daemonGone = await fetch(daemonUrl).then(() => false, () => true);
        if (!daemonGone) await delay(250);
      }
      expect(daemonGone, 'precondition: the killed daemon stopped answering').toBe(true);

      const restart = await context.restart();

      const deadline = Date.now() + RECONCILED_TIMEOUT_MS;
      let assistant: E2eChatMessage | undefined;
      let stored: StoredStatusEvent | null = null;
      while (Date.now() < deadline) {
        assistant = (await listMessages(restart.webUrl, projectId, conversationId))
          .find((message) => message.id === assistantMessageId);
        stored = lastErrorEvent(assistant);
        if (assistant?.runStatus === 'failed' && stored) break;
        await delay(1000);
      }

      expect(
        assistant?.runStatus,
        'startup reconciliation fails the run the restart interrupted',
      ).toBe('failed');
      expect(stored, 'the reconciled message carries an error event').toBeTruthy();
      expect(
        stored?.code,
        'the stored event names the cause, so the alert can title itself',
      ).toBe('DAEMON_RESTARTED');
      expect(stored?.failureCategory).toBe('process_exit');
      expect(stored?.failureDetail).toBe('interrupted');
      expect(
        stored?.failureStage,
        'the stored event names the step the durable event log says the run reached',
      ).toBe('tool_execution');
      expect(
        stored?.artifactCount,
        'the stored event states the files the durable event log proves the run wrote',
      ).toBe(1);
    }, {
      // The daemon is killed on purpose, so its log carries the fatal-looking
      // lines a normal exit does not.
      skipFatalLogCheck: true,
    });
  }, 300_000);
});
