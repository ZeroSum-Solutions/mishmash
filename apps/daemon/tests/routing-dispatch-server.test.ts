// Dispatch-time routing integration -- SERVER-LEVEL coverage (WR wave, P2
// tranche, t9 -- plan docs/plans/2026-08-05-model-routing-system.md §3.1
// binding point). apps/daemon/tests/routing-dispatch.test.ts already covers
// apps/daemon/src/routing/dispatch.ts's pure functions directly; THIS file
// proves the additive server.ts wiring (startChatRun's pre-spawn
// resolveDispatchRouting/recordDispatchIntent hook + onRunFinished's
// reconcilePostRun hook) actually fires on a REAL POST /api/chat request
// through a REAL booted daemon (`startServer`), the same pattern
// chat-route.test.ts already establishes (PATH-overlaid fake agent binary,
// no mocks/ replay corpus needed for a plain opencode-protocol success run).
//
// Two round trips: an explicit `routingOverride` (proves 'override' mode
// reaches the wire) and a plain request with none (proves WR-routing.md
// Fallback B's 'runtime-default' mode -- the ONLY mode a real /api/chat
// request can reach today, since ChatRequest carries no templateId/
// buildClass/taskClass; see dispatch.ts's own header for the governance
// gap this reflects). Both assert the pre-spawn ROUTED telemetry row via
// this wave's own GET /api/routing/telemetry, and that the OBSERVED side
// gets filled in once the run reports back (reconcilePostRun).

import type http from 'node:http';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { StoredRoutingTelemetryRow } from '@open-design/contracts';

import { startServer } from '../src/server.js';

async function withFakeOpencodeAgent<T>(script: string, run: () => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'od-routing-dispatch-bin-'));
  const oldPath = process.env.PATH;
  try {
    const bin = join(dir, 'opencode');
    await fsp.writeFile(bin, `#!/usr/bin/env node\n${script}`);
    await fsp.chmod(bin, 0o755);
    process.env.PATH = `${dir}${delimiter}${oldPath ?? ''}`;
    return await run();
  } finally {
    process.env.PATH = oldPath;
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

const SUCCESS_SCRIPT = `
console.log(JSON.stringify({ type: 'step_start', sessionID: 'routing-dispatch-session' }));
console.log(JSON.stringify({ type: 'text', sessionID: 'routing-dispatch-session', part: { text: 'hello from the fake agent' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { tokens: { input: 5, output: 5 } } }));
process.exit(0);
`;

describe('dispatch-time routing wiring in the real chat dispatch path', () => {
  let server: http.Server;
  let baseUrl: string;
  const originalPath = process.env.PATH;

  beforeAll(async () => {
    const started = (await startServer({ port: 0, returnServer: true })) as {
      url: string;
      server: http.Server;
    };
    baseUrl = started.url;
    server = started.server;
  });

  afterEach(() => {
    if (originalPath == null) delete process.env.PATH;
    else process.env.PATH = originalPath;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function createProject(): Promise<string> {
    const projectId = `proj-routing-dispatch-${randomUUID()}`;
    const createResponse = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: projectId, name: 'Routing dispatch server test fixture', skillId: null, designSystemId: null }),
    });
    expect(createResponse.status).toBe(200);
    return projectId;
  }

  async function runChatAndGetRunId(
    projectId: string,
    conversationId: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    // The ENTIRE request/response lifecycle (fetch + draining the SSE body
    // via .text()) must run INSIDE withFakeOpencodeAgent's PATH-scoped
    // callback, not just the fetch() call: fetch() resolves as soon as
    // response headers arrive (design.runs.stream starts the SSE response
    // immediately), while the actual agent spawn/PATH resolution happens
    // ASYNCHRONOUSLY afterward, while the body is still streaming. Resetting
    // PATH right after fetch() resolves (before the body finishes) would
    // race the real spawn attempt off of PATH entirely.
    const text = await withFakeOpencodeAgent(SUCCESS_SCRIPT, async () => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // A `projectId` is REQUIRED for server.ts's onRunFinished hook (usage
        // tracking AND this wave's reconcilePostRun addition both live behind
        // its `if (!run.projectId || !run.id) return;` guard) to run at all.
        body: JSON.stringify({ agentId: 'opencode', projectId, conversationId, message: 'hello', ...body }),
      });
      expect(response.ok).toBe(true);
      return response.text();
    });
    expect(text).toContain('"status":"succeeded"');

    const runsResponse = await fetch(`${baseUrl}/api/runs?conversationId=${encodeURIComponent(conversationId)}`);
    const runsBody = (await runsResponse.json()) as { runs: Array<{ id: string; status: string }> };
    expect(runsBody.runs).toHaveLength(1);
    expect(runsBody.runs[0]!.status).toBe('succeeded');
    return runsBody.runs[0]!.id;
  }

  it('records a routed-vs-observed telemetry row for an explicit routingOverride, end to end over HTTP', async () => {
    const projectId = await createProject();
    const conversationId = `conv-routing-override-${randomUUID()}`;
    const runId = await runChatAndGetRunId(projectId, conversationId, {
      routingOverride: { model: 'gpt-5.6-sol', lane: 'openrouter', reason: 'server-level override test' },
    });

    const telemetryResponse = await fetch(`${baseUrl}/api/routing/telemetry?runId=${encodeURIComponent(runId)}`);
    expect(telemetryResponse.status).toBe(200);
    const telemetryBody = (await telemetryResponse.json()) as { rows: StoredRoutingTelemetryRow[] };
    expect(telemetryBody.rows).toHaveLength(1);
    const row = telemetryBody.rows[0]!;
    // Pre-spawn ROUTED side: the override, not the opencode runtime default.
    expect(row.routedModel).toBe('gpt-5.6-sol');
    expect(row.routedLane).toBe('openrouter');
    // Post-run OBSERVED side: reconcilePostRun (server.ts's onRunFinished
    // hook) filled it in once the run reported back.
    expect(row.observedModel).not.toBeNull();
  });

  it('records a runtime-default telemetry row for a plain chat request with no override or taskClass (WR-routing.md Fallback B)', async () => {
    const projectId = await createProject();
    const conversationId = `conv-routing-default-${randomUUID()}`;
    const runId = await runChatAndGetRunId(projectId, conversationId, {});

    const telemetryResponse = await fetch(`${baseUrl}/api/routing/telemetry?runId=${encodeURIComponent(runId)}`);
    expect(telemetryResponse.status).toBe(200);
    const telemetryBody = (await telemetryResponse.json()) as { rows: StoredRoutingTelemetryRow[] };
    expect(telemetryBody.rows).toHaveLength(1);
    const row = telemetryBody.rows[0]!;
    expect(row.routedLane).toBe('runtime-default');
    expect(row.stage).toBe('chat');
  });
});
