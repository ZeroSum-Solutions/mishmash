// W1J.2 red spec (daemon half). A client that never reads the create response
// still holds two ids for the run the daemon may already have accepted: the
// `clientRequestId` it minted and sent, and the `assistantMessageId` the daemon
// pinned onto the stored row before it answered. Both must come back out of the
// run read-back surfaces, or the client cannot find its own run and has nothing
// to do but declare a running turn failed.
//
// `apps/daemon/src/routes/runs.ts` creates and pins the run BEFORE it sends the
// 202 and starts it afterwards, so a lost response never means a lost run. The
// gap this pins: `statusBody` (`apps/daemon/src/runtimes/runs.ts`) keeps
// `assistantMessageId` but drops `clientRequestId`, so neither
// `GET /api/runs/:id` nor `GET /api/runs?conversationId=…` can be matched back
// to the request that made the run.

import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

type StartedServer = { url: string; server: Server; shutdown?: () => Promise<void> | void };

interface RunReadBack {
  id: string;
  conversationId: string | null;
  assistantMessageId: string | null;
  clientRequestId: string | null;
}

describe('run read-back carries the ids a client owns', () => {
  let started: StartedServer | null = null;

  afterEach(async () => {
    await Promise.resolve(started?.shutdown?.());
    if (started?.server) {
      await new Promise<void>((resolve) => started?.server.close(() => resolve()));
    }
    started = null;
  });

  it('GET /api/runs/:id echoes the clientRequestId the create request carried', async () => {
    started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    const url = started.url;

    const projectId = `crid_status_${randomUUID()}`;
    await createProject(url, projectId, 'Client request id status read-back');
    const conversationId = await firstConversationId(url, projectId);

    const assistantMessageId = `assistant_crid_${randomUUID()}`;
    const clientRequestId = `client_crid_${randomUUID()}`;
    const runId = await createRun(url, {
      projectId,
      conversationId,
      assistantMessageId,
      clientRequestId,
    });

    const status = await readRun(url, runId);
    expect(status.assistantMessageId).toBe(assistantMessageId);
    expect(status.clientRequestId).toBe(clientRequestId);
  });

  it('GET /api/runs?conversationId= lists the run under the ids its client owns', async () => {
    started = (await startServer({ port: 0, returnServer: true })) as StartedServer;
    const url = started.url;

    const projectId = `crid_list_${randomUUID()}`;
    await createProject(url, projectId, 'Client request id list read-back');
    const conversationId = await firstConversationId(url, projectId);

    const assistantMessageId = `assistant_crid_${randomUUID()}`;
    const clientRequestId = `client_crid_${randomUUID()}`;
    const runId = await createRun(url, {
      projectId,
      conversationId,
      assistantMessageId,
      clientRequestId,
    });

    const response = await fetch(
      `${url}/api/runs?conversationId=${encodeURIComponent(conversationId)}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { runs: RunReadBack[] };
    const listed = body.runs.find((run) => run.id === runId);
    expect(listed).toBeTruthy();
    // The match a client with no run id makes: its own request id first, its own
    // assistant row id second.
    expect(listed?.clientRequestId).toBe(clientRequestId);
    expect(listed?.assistantMessageId).toBe(assistantMessageId);
  });
});

async function createProject(url: string, id: string, name: string): Promise<void> {
  const response = await fetch(`${url}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, name, metadata: { kind: 'prototype' }, skipDiscoveryBrief: true }),
  });
  expect(response.status).toBe(200);
}

async function firstConversationId(url: string, projectId: string): Promise<string> {
  const response = await fetch(`${url}/api/projects/${encodeURIComponent(projectId)}/conversations`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as { conversations: Array<{ id: string }> };
  const id = body.conversations[0]?.id;
  expect(id).toBeTruthy();
  return id!;
}

async function createRun(
  url: string,
  meta: {
    projectId: string;
    conversationId: string;
    assistantMessageId: string;
    clientRequestId: string;
  },
): Promise<string> {
  const response = await fetch(`${url}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...meta,
      agentId: 'claude',
      message: 'CLIENT_REQUEST_ID_MARKER',
      currentPrompt: 'CLIENT_REQUEST_ID_MARKER',
    }),
  });
  expect(response.status).toBe(202);
  const body = (await response.json()) as { runId: string };
  expect(body.runId).toBeTruthy();
  return body.runId;
}

async function readRun(url: string, runId: string): Promise<RunReadBack> {
  const response = await fetch(`${url}/api/runs/${encodeURIComponent(runId)}`);
  expect(response.status).toBe(200);
  return (await response.json()) as RunReadBack;
}
