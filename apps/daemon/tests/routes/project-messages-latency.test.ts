/**
 * INV-3.2 at the daemon boundary — the message PUT is independent of the run.
 *
 * The 29–36 s message PUT this wave chases is browser-side queueing, not handler
 * time: the cause is reproduced and fixed on the web side, and the criterion is
 * pinned end to end on the real wire by `e2e/ui/tab-stream-budget.test.ts`. This
 * file is the daemon half of the same invariant, and it is a REGRESSION GUARD,
 * not a red spec: it is green on the base tree as well as on the branch, because
 * the handler is already independent of the run and the point is to keep it that
 * way.
 *
 * What it would catch. `apps/daemon/src/routes/project/conversations.ts` handles
 * the write synchronously — `upsertMessage` and
 * `holdTerminalRunStatusOnMessageWrite` are plain better-sqlite3 calls and
 * `reportFinalizedMessage` is fire-and-forget — so a future change that awaited
 * run finalization, awaited telemetry, or held a write transaction across I/O
 * would blow the 2,000 ms budget here even though nothing in the wire format
 * changed. That is the PRD's stated fear, written down as a test.
 *
 * "While its conversation run is active" at this layer means the conversation
 * stores an assistant row in a non-terminal run status: the handler's only
 * run-awareness is that stored row (`run-terminal-reconciliation.ts`
 * `holdTerminalRunStatusOnMessageWrite` reads `messages`, not the run registry).
 * The daemon's in-memory run object is what the e2e case covers, through
 * `POST /api/runs` against a real agent runtime.
 *
 * Real SQLite in a temp data root: `tests/setup.ts` points `OD_DATA_DIR` at one
 * `mkdtemp` directory per vitest process before any test imports `server.ts`.
 */
import type http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatMessage, MessagesResponse } from '@open-design/contracts';

import { startServer } from '../../src/server.js';

/** INV-3.2's budget for one message PUT. */
const MESSAGE_WRITE_BUDGET_MS = 2_000;
/** Overlapping writes for one conversation, to put the SQLite file under contention. */
const OVERLAPPING_WRITES = 20;

describe('PUT /api/projects/:id/conversations/:cid/messages/:mid under an active run', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function createConversation(projectId: string): Promise<string> {
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        name: 'W3E message latency fixture',
        skillId: null,
        designSystemId: null,
        pendingPrompt: null,
        metadata: { kind: 'prototype' },
      }),
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { conversationId: string }).conversationId;
  }

  async function putMessage(
    projectId: string,
    conversationId: string,
    message: ChatMessage,
  ): Promise<{ status: number; elapsedMs: number; body: { message?: ChatMessage } }> {
    const startedAt = performance.now();
    const response = await fetch(
      `${baseUrl}/api/projects/${projectId}/conversations/${conversationId}/messages/${message.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      },
    );
    const body = (await response.json()) as { message?: ChatMessage };
    return { status: response.status, elapsedMs: performance.now() - startedAt, body };
  }

  async function listMessages(projectId: string, conversationId: string): Promise<MessagesResponse> {
    const response = await fetch(
      `${baseUrl}/api/projects/${projectId}/conversations/${conversationId}/messages`,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as MessagesResponse;
  }

  /** An assistant row mid-run: the state that makes this conversation's run active. */
  function activeRunRow(id: string, startedAt: number): ChatMessage {
    return {
      id,
      role: 'assistant',
      content: '',
      agentId: 'codex',
      agentName: 'Codex',
      createdAt: startedAt,
      runId: `${id}-run`,
      runStatus: 'running',
      startedAt,
    };
  }

  it('persists and answers with a contract-valid response under budget while the run is active', async () => {
    const projectId = `w3e-latency-${Date.now()}`;
    const conversationId = await createConversation(projectId);
    const now = Date.now();

    const assistantId = `assistant-${projectId}`;
    const pinned = await putMessage(projectId, conversationId, activeRunRow(assistantId, now));
    expect(pinned.status).toBe(200);

    // Precondition, not the bar: this conversation's run is active.
    const beforeWrite = await listMessages(projectId, conversationId);
    expect(beforeWrite.messages.find((entry) => entry.id === assistantId)?.runStatus).toBe('running');

    const userMessage: ChatMessage = {
      id: `user-${projectId}`,
      role: 'user',
      content: 'a message written while the run is still going',
      createdAt: now + 1,
    };
    const write = await putMessage(projectId, conversationId, userMessage);

    expect(write.status).toBe(200);
    expect(write.body.message?.id).toBe(userMessage.id);
    expect(
      write.elapsedMs,
      `the write must answer inside ${MESSAGE_WRITE_BUDGET_MS} ms while the run is active`,
    ).toBeLessThan(MESSAGE_WRITE_BUDGET_MS);

    const listed = await listMessages(projectId, conversationId);
    expect(Array.isArray(listed.messages)).toBe(true);
    expect(listed.messages.map((entry) => entry.id)).toContain(userMessage.id);
    expect(listed.messages.find((entry) => entry.id === userMessage.id)?.content)
      .toBe(userMessage.content);
    // The write neither ended the run nor was held by it.
    expect(listed.messages.find((entry) => entry.id === assistantId)?.runStatus).toBe('running');
  });

  it('stays under budget when writes for the same conversation overlap', async () => {
    const projectId = `w3e-latency-overlap-${Date.now()}`;
    const conversationId = await createConversation(projectId);
    const now = Date.now();

    const assistantId = `assistant-${projectId}`;
    expect((await putMessage(projectId, conversationId, activeRunRow(assistantId, now))).status)
      .toBe(200);

    // The PRD's third suspect is a SQLite lock held across the write. Overlapping
    // writes to one conversation are what would expose it.
    const writes = await Promise.all(
      Array.from({ length: OVERLAPPING_WRITES }, (_unused, index) =>
        putMessage(projectId, conversationId, {
          id: `user-${projectId}-${index}`,
          role: 'user',
          content: `overlapping write ${index}`,
          createdAt: now + 1 + index,
        })),
    );

    for (const write of writes) expect(write.status).toBe(200);
    const slowest = Math.max(...writes.map((write) => write.elapsedMs));
    expect(
      slowest,
      `the slowest of ${OVERLAPPING_WRITES} overlapping writes must answer inside ${MESSAGE_WRITE_BUDGET_MS} ms`,
    ).toBeLessThan(MESSAGE_WRITE_BUDGET_MS);

    const listed = await listMessages(projectId, conversationId);
    const ids = new Set(listed.messages.map((entry) => entry.id));
    for (let index = 0; index < OVERLAPPING_WRITES; index += 1) {
      expect(ids.has(`user-${projectId}-${index}`)).toBe(true);
    }
    expect(listed.messages.find((entry) => entry.id === assistantId)?.runStatus).toBe('running');
  });
});
