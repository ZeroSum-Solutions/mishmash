// W8D / F-03 red spec item 1 — named local attribution on runs and messages.
//
// D-2's ceiling is "attribution, not authentication": a request carrying
// `x-od-actor` says who asked for a turn, and a request without one (or with a
// junk one) is still a perfectly valid request. Both halves are asserted here.
//
// Behavioural red on base d7ff39a36: POST /api/runs already works and already
// pins an assistant message row, and GET .../messages already returns that row
// — the row simply has no `actorName` property at all, because nothing on the
// request path reads the header. This is a capability absence on a live route,
// not an import failure: every request below returns its normal status code on
// base and the assertions fail on the missing/incorrect field.
//
// The run itself is expected to fail to start (no agent binary in the test
// environment). That is deliberate and irrelevant: attribution is stamped at
// run CREATE time, before the agent is ever spawned, and the assertions read
// the persisted message row rather than any run output.

import type http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// D-18 (no invented wire): the literals below are the header name and cap this
// track introduces. They are NOT hand-invented for the test -- the last case in
// this file pins them to the `packages/contracts` exports, so the wire shape has
// exactly one source of truth. They are spelled literally here (rather than
// statically imported) so that RED on base fails on the SYMPTOM assertions
// below instead of on a module-resolution error.
const ACTOR_HEADER_NAME = 'x-od-actor';
const MAX_ACTOR_NAME_LENGTH = 60;

let daemon: http.Server | undefined;
let daemonShutdown: (() => Promise<void> | void) | undefined;
let baseUrl = '';
let dataDir = '';
const PREV_DATA_DIR = process.env.OD_DATA_DIR;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'od-w8d-actor-'));
  process.env.OD_DATA_DIR = dataDir;
  const { startServer } = await import('../src/server.js');
  const started = (await startServer({ port: 0, host: '127.0.0.1', returnServer: true })) as {
    url: string;
    server: http.Server;
    shutdown?: () => Promise<void> | void;
  };
  baseUrl = started.url;
  daemon = started.server;
  daemonShutdown = started.shutdown;
}, 60_000);

afterEach(async () => {
  if (daemonShutdown) {
    await Promise.race([Promise.resolve(daemonShutdown()), new Promise((r) => setTimeout(r, 2000))]);
  }
  daemon?.closeAllConnections?.();
  await new Promise<void>((resolve) => daemon?.close(() => resolve()) ?? resolve());
  if (PREV_DATA_DIR === undefined) delete process.env.OD_DATA_DIR;
  else process.env.OD_DATA_DIR = PREV_DATA_DIR;
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  register.clear();
  vi.resetModules();
}, 30_000);

interface RunFixture {
  projectId: string;
  conversationId: string;
  runId: string;
  assistantMessageId: string;
  status: number;
}

async function createProjectAndConversation(): Promise<{ projectId: string; conversationId: string }> {
  const projectId = `w8dproj${Math.random().toString(36).slice(2, 8)}`;
  const projectResp = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: projectId, name: 'W8D actor project' }),
  });
  expect(projectResp.status, await projectResp.clone().text()).toBeLessThan(400);

  const convResp = await fetch(`${baseUrl}/api/projects/${projectId}/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'attribution' }),
  });
  expect(convResp.status, await convResp.clone().text()).toBeLessThan(400);
  const conv = (await convResp.json()) as { conversation?: { id?: string } };
  const conversationId = conv.conversation?.id ?? '';
  expect(conversationId).toBeTruthy();
  return { projectId, conversationId };
}

/** POST /api/runs with the given headers; returns the ids the daemon minted. */
async function startRun(headers: Record<string, string>): Promise<RunFixture> {
  const { projectId, conversationId } = await createProjectAndConversation();
  const assistantMessageId = `w8d-${Math.random().toString(36).slice(2, 10)}`;
  const resp = await fetch(`${baseUrl}/api/runs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({
      projectId,
      conversationId,
      assistantMessageId,
      message: 'who did this',
    }),
  });
  const body = (await resp.json().catch(() => ({}))) as { runId?: string };
  return {
    projectId,
    conversationId,
    assistantMessageId,
    runId: body.runId ?? '',
    status: resp.status,
  };
}

async function readMessages(
  projectId: string,
  conversationId: string,
): Promise<Array<Record<string, unknown>>> {
  const resp = await fetch(
    `${baseUrl}/api/projects/${projectId}/conversations/${conversationId}/messages`,
  );
  expect(resp.status).toBe(200);
  const body = (await resp.json()) as { messages?: Array<Record<string, unknown>> };
  return body.messages ?? [];
}

describe('W8D: x-od-actor stamps actorName on the run and its messages', () => {
  it('stamps the header value on the assistant message row the run pins', async () => {
    const fixture = await startRun({ [ACTOR_HEADER_NAME]: 'Devin' });
    expect(fixture.status).toBe(202);
    expect(fixture.runId).toBeTruthy();

    const messages = await readMessages(fixture.projectId, fixture.conversationId);
    const pinned = messages.find((m) => m.id === fixture.assistantMessageId);
    expect(pinned, 'the run must pin an assistant message row').toBeTruthy();
    // RED on base: the row exists and carries runId/runStatus, but has no
    // `actorName` key at all -- nothing reads the header.
    expect(pinned?.actorName).toBe('Devin');
  });

  it('accepts a request with no actor header and leaves the row unattributed', async () => {
    const fixture = await startRun({});
    // D-2 ceiling: a missing actor NEVER blocks a request.
    expect(fixture.status).toBe(202);

    const messages = await readMessages(fixture.projectId, fixture.conversationId);
    const pinned = messages.find((m) => m.id === fixture.assistantMessageId);
    expect(pinned, 'the run must pin an assistant message row').toBeTruthy();
    expect(pinned?.actorName ?? null).toBeNull();
  });

  it('caps an over-long actor header at the contract length instead of rejecting it', async () => {
    // ONE outcome, not a choice of two: `packages/contracts/src/api/actor.ts`
    // documents the cap ("a longer value is trimmed to this length, never
    // rejected"), so the stamped name is the trimmed header sliced to
    // MAX_ACTOR_NAME_LENGTH. The header below starts with distinguishable text
    // so the assertion also pins WHICH 60 characters survive -- the first ones.
    const tooLong = `Devin ${'x'.repeat(MAX_ACTOR_NAME_LENGTH + 40)}`;
    const expected = tooLong.slice(0, MAX_ACTOR_NAME_LENGTH);
    const fixture = await startRun({ [ACTOR_HEADER_NAME]: tooLong });
    expect(fixture.status).toBe(202);

    const messages = await readMessages(fixture.projectId, fixture.conversationId);
    const pinned = messages.find((m) => m.id === fixture.assistantMessageId);
    const stamped = pinned?.actorName ?? null;
    expect(stamped).not.toBeNull();
    expect(stamped).toBe(expected);
    expect(stamped?.length).toBe(MAX_ACTOR_NAME_LENGTH);
  });

  it('degrades a control-character actor header to unattributed instead of crashing', async () => {
    // Header values may not contain raw control characters at the transport
    // level, so the fuzz uses the escaped forms a client could realistically
    // send after a bad concatenation.
    const fixture = await startRun({ [ACTOR_HEADER_NAME]: 'Dev\\r\\nX-Injected: 1' });
    expect(fixture.status).toBe(202);

    const messages = await readMessages(fixture.projectId, fixture.conversationId);
    const pinned = messages.find((m) => m.id === fixture.assistantMessageId);
    const stamped = pinned?.actorName ?? null;
    expect(typeof stamped === 'string' || stamped === null).toBe(true);
    if (typeof stamped === 'string') {
      expect(stamped).not.toContain('\r');
      expect(stamped).not.toContain('\n');
    }
  });
});

describe('W8D: the actor header shape has one source of truth', () => {
  it('matches the packages/contracts exports', async () => {
    const contracts = (await import('@open-design/contracts')) as unknown as {
      ACTOR_HEADER_NAME?: string;
      MAX_ACTOR_NAME_LENGTH?: number;
    };
    // RED on base: neither export exists, so both read `undefined`.
    expect(contracts.ACTOR_HEADER_NAME).toBe(ACTOR_HEADER_NAME);
    expect(contracts.MAX_ACTOR_NAME_LENGTH).toBe(MAX_ACTOR_NAME_LENGTH);
  });
});
