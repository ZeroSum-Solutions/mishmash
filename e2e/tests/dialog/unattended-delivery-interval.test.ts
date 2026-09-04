// @vitest-environment node

// Track 1G.3 follow-up — the startup delivery replay attributes files by the
// run's START alone, so an old unclassified turn collects everything written
// after it.
//
// `replayUnattendedDeliveryClassifications`
// (`apps/daemon/src/runtimes/run-delivery-classification.ts`) asks
// `classifyUnattendedRunDelivery` to decide every succeeded design row that
// still carries no verdict, and that decision attributes project files through
// `isRunTouchedProjectFile` (`apps/daemon/src/projects.ts`):
// `fileMtimeMs + GRACE >= runStartTimeMs`. The predicate has a lower bound and
// no upper bound. For the settle-window timer that is harmless — it fires
// seconds after the run ended and reads the tree then — but the replay may run
// long after the fact over a backlog, and every surviving file written since
// the old run BEGAN is then recorded as that run's output, including a later
// turn's files. Because `deliveredFileCount > 0` is what makes a turn
// `delivered` (`resolveDesignDeliveryOutcomeFromEvidence`,
// `packages/contracts/src/api/delivery.ts`), an empty turn can be persisted as
// a delivering one, and `produced_files_json` is a stored contract, not a
// display hint.
//
// This spec drives two design turns in one project at the daemon HTTP boundary
// with no web client attached: the first delivers no project file, the second
// writes `index.html`. It kills the daemon before either settle-window timer
// fires, starts it again on the same data root so the startup replay decides
// both rows, and asserts the FIRST row is not credited with the SECOND turn's
// file.

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

type ProjectFilesResponse = { files: Array<{ mtime: number; name: string }> };

// The fake codex runtime answers this prompt with text only: no tool call, no
// project file (`e2e/lib/fake-agents.ts`, the default runtime-smoke branch).
// This is the genuinely empty turn whose verdict the replay must not inflate.
const EMPTY_PROMPT = 'Fake runtime smoke for codex';

// The fake codex runtime writes `index.html` and `plan.md` straight into the
// project directory for this prompt and then reports success
// (`e2e/lib/fake-agents.ts` `emitPlanArtifactGenerateRun`).
const DELIVERING_PROMPT = 'Generate the deterministic artifact from the plan document';

// `CLIENT_FINALIZE_SETTLE_MS` in `apps/daemon/src/server.ts`. Mirrored rather
// than imported: `e2e/` must not reach into an app's private source. Both turns
// have to still be unclassified when the daemon goes down, or the startup
// replay is not what decides them and this spec proves nothing.
const CLIENT_FINALIZE_SETTLE_MS = 15_000;

// `RUN_ARTIFACT_RECONCILE_MTIME_GRACE_MS` in `apps/daemon/src/projects.ts`,
// mirrored for the same reason. The second turn's write has to land clear of
// the first turn's terminal PLUS this grace, otherwise a correctly bounded
// attribution would include it anyway and the spec could pass for the wrong
// reason. Asserted below rather than assumed.
const RUN_TOUCH_GRACE_MS = 1_000;

// How long to hold between the first turn's terminal and the second turn's
// start. Larger than the grace above so the second turn's write is
// unambiguously outside the first run's interval, small enough that both turns
// still finish inside one settle window.
const INTER_TURN_GAP_MS = 2_500;

// After the restart the daemon has one boot to record both verdicts. Generous
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
  expect(assistant, `assistant message ${assistantMessageId} present`).toBeDefined();
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

function producedNamesOf(row: E2eChatMessage): unknown[] | null {
  return Array.isArray(row.producedFiles)
    ? (row.producedFiles as Array<{ name?: unknown }>).map((file) => file?.name)
    : null;
}

async function listProjectFiles(webUrl: string, projectId: string): Promise<ProjectFilesResponse> {
  return await requestJson<ProjectFilesResponse>(
    webUrl,
    `/api/projects/${encodeURIComponent(projectId)}/files`,
  );
}

describe('dialog unattended delivery replay bounds attribution to the run interval', () => {
  test('a replayed empty turn is not credited with a later turn\'s file', async () => {
    const suite = await createSmokeSuite('dialog-unattended-delivery-interval');

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
          name: 'Dialog unattended delivery interval project',
          pendingPrompt: null,
          skillId: null,
        },
      });
      const projectId = project.project.id;
      const conversationId = project.conversationId;

      // ---- Turn 1: a design turn that hands the user no project file. -------
      const emptyStartedAt = Date.now();
      const emptyMessageId = `assistant-empty-${emptyStartedAt}`;
      await saveMessage(context.webUrl, projectId, conversationId, {
        content: EMPTY_PROMPT,
        createdAt: emptyStartedAt,
        id: `user-empty-${emptyStartedAt}`,
        role: 'user',
      });
      await saveMessage(context.webUrl, projectId, conversationId, {
        agentId: 'codex',
        agentName: 'Codex',
        content: '',
        createdAt: emptyStartedAt,
        events: [],
        id: emptyMessageId,
        role: 'assistant',
        runStatus: 'running',
        sessionMode: 'design',
        startedAt: emptyStartedAt,
      });

      const emptyRun = await startRun(context.webUrl, {
        agentId: 'codex',
        assistantMessageId: emptyMessageId,
        clientRequestId: `req-empty-${emptyStartedAt}`,
        conversationId,
        designSystemId: null,
        message: EMPTY_PROMPT,
        model: 'default',
        projectId,
        reasoning: 'default',
        sessionMode: 'design',
        skillId: null,
      });
      const emptyFinal = await waitForRunTerminal(context.webUrl, emptyRun.runId, {
        timeoutMs: 90_000,
      });
      expect(emptyFinal.status, 'the empty turn reached its succeeded terminal event')
        .toBe('succeeded');
      // `updatedAt` is stamped by the same `emit('end', ...)` that writes the
      // run's terminal record, so it is the daemon's own end-of-interval clock.
      const emptyEndedAt = emptyFinal.updatedAt;

      expect(
        (await listProjectFiles(context.webUrl, projectId)).files.map((file) => file.name),
        'precondition: the first turn wrote no project file',
      ).toEqual([]);

      // ---- Turn 2: a design turn that writes index.html. --------------------
      await delay(INTER_TURN_GAP_MS);
      const deliveringStartedAt = Date.now();
      const deliveringMessageId = `assistant-delivering-${deliveringStartedAt}`;
      await saveMessage(context.webUrl, projectId, conversationId, {
        content: DELIVERING_PROMPT,
        createdAt: deliveringStartedAt,
        id: `user-delivering-${deliveringStartedAt}`,
        role: 'user',
      });
      await saveMessage(context.webUrl, projectId, conversationId, {
        agentId: 'codex',
        agentName: 'Codex',
        content: '',
        createdAt: deliveringStartedAt,
        events: [],
        id: deliveringMessageId,
        role: 'assistant',
        runStatus: 'running',
        sessionMode: 'design',
        startedAt: deliveringStartedAt,
      });

      const deliveringRun = await startRun(context.webUrl, {
        agentId: 'codex',
        assistantMessageId: deliveringMessageId,
        clientRequestId: `req-delivering-${deliveringStartedAt}`,
        conversationId,
        designSystemId: null,
        message: DELIVERING_PROMPT,
        model: 'default',
        projectId,
        reasoning: 'default',
        sessionMode: 'design',
        skillId: null,
      });
      const deliveringFinal = await waitForRunTerminal(context.webUrl, deliveringRun.runId, {
        timeoutMs: 90_000,
      });
      expect(deliveringFinal.status, 'the delivering turn reached its succeeded terminal event')
        .toBe('succeeded');

      const projectFiles = await listProjectFiles(context.webUrl, projectId);
      const indexHtml = projectFiles.files.find((file) => file.name === 'index.html');
      expect(indexHtml, 'precondition: the second turn wrote index.html').toBeDefined();
      // The whole defect is about a file written OUTSIDE the first run's
      // interval. If this write landed inside the first turn's terminal plus
      // its grace, a correctly bounded attribution would include it too and the
      // spec would pass without proving anything.
      expect(
        indexHtml!.mtime - emptyEndedAt,
        'precondition: the second turn wrote index.html clear of the first run interval',
      ).toBeGreaterThan(RUN_TOUCH_GRACE_MS);

      // Precondition: neither turn is classified yet, so what the restart
      // replays is the daemon's own pending verdict and not an earlier write.
      for (const messageId of [emptyMessageId, deliveringMessageId]) {
        const before = await readAssistantRow(
          context.webUrl,
          projectId,
          conversationId,
          messageId,
        );
        expect(
          before.resultDeliveryState ?? null,
          `precondition: ${messageId} is still unclassified when the daemon goes down`,
        ).toBeNull();
      }

      const restart = await context.restart();
      // If the daemon outlived the FIRST turn's settle window, that turn's
      // timer already wrote its verdict and the startup replay never saw it.
      expect(
        restart.stoppedAt - emptyEndedAt,
        'the daemon went down inside the first turn\'s client-finalize settle window',
      ).toBeLessThan(CLIENT_FINALIZE_SETTLE_MS);

      const emptyRow = await waitForClassifiedRow(
        restart.webUrl,
        projectId,
        conversationId,
        emptyMessageId,
      );

      expect(
        producedNamesOf(emptyRow),
        'the replayed empty turn is not credited with the later turn\'s file',
      ).not.toContain('index.html');
      expect(
        producedNamesOf(emptyRow),
        'the replayed empty turn is not credited with the later turn\'s plan document',
      ).not.toContain('plan.md');
      expect(
        emptyRow.resultDeliveryState,
        'a turn that handed the user nothing is not recorded as delivered',
      ).not.toBe('delivered');

      // The bound must not cost the delivering turn its own true file list.
      const deliveringRow = await waitForClassifiedRow(
        restart.webUrl,
        projectId,
        conversationId,
        deliveringMessageId,
      );
      expect(
        deliveringRow.resultDeliveryState,
        'the delivering turn is still classified as delivered',
      ).toBe('delivered');
      expect(
        producedNamesOf(deliveringRow),
        'the delivering turn still owns the file it wrote',
      ).toContain('index.html');
    });
  }, 300_000);
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
