// Red spec (W3G / PRD 3.7, item T-07): does the router ever engage on
// `/api/chat`, and can a reader TELL from the stored row?
//
// The live daemon's `routing_telemetry` table holds 286 rows (all written
// after the dispatch wiring landed), every one with `routed_lane =
// 'runtime-default'`, `observed_lane` empty, `gate_outcomes_json = '{}'` and
// `escalated = 0`. That reads like "the router records nothing", but it is
// ambiguous: `resolveDispatchRouting` (apps/daemon/src/routing/dispatch.ts)
// DOES compute a three-way verdict per dispatch -- `'routed'`, `'override'`,
// or `'runtime-default'` (WR-routing.md Fallback B) -- and
// `recordDispatchIntent` (dispatch.ts:747) then DROPS that verdict, storing
// only the resulting lane. A reader querying the table cannot separate "the
// router engaged and picked a lane" from "the router never engaged and the
// runtime's own default was kept", because nothing in the row says which.
//
// Both round trips below drive a REAL `POST /api/chat` through a REAL booted
// daemon (`startServer`) with a PATH-overlaid fake agent binary -- the same
// harness apps/daemon/tests/routing-dispatch-server.test.ts already
// establishes, with its committed fixture scripts reused verbatim (D-18: no
// invented wire). They then read the row the daemon actually persisted,
// straight out of its SQLite file, and assert the row STATES its engagement:
//
//   1. an explicit `routingOverride` naming a real vetted (model, lane) pair
//      -> the router engaged
//   2. a plain request with neither override nor task class -> Fallback B,
//      the router did not engage
//
// RED on main: the persisted row carries no engagement column at all, so the
// first assertion in each case ("the stored row must state whether routing
// engaged") fails on the column list.
import type http from 'node:http';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { startServer } from '../src/server.js';

// Fixture scripts copied verbatim from apps/daemon/tests/
// routing-dispatch-server.test.ts (the committed recording of a real
// claude-code / opencode stdout stream) so this spec invents no wire shape.
const CLAUDE_SUCCESS_SCRIPT = `
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', model: 'fake-claude-model', session_id: 'routing-engagement-claude-session' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'text', text: 'hello from the fake claude agent' }], stop_reason: 'end_turn' } }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'routing-engagement-claude-session', usage: { input_tokens: 5, output_tokens: 5 }, total_cost_usd: 0.001, duration_ms: 10 }) + '\\n');
setTimeout(() => process.exit(0), 20);
`;

const OPENCODE_SUCCESS_SCRIPT = `
console.log(JSON.stringify({ type: 'step_start', sessionID: 'routing-engagement-session' }));
console.log(JSON.stringify({ type: 'text', sessionID: 'routing-engagement-session', part: { text: 'hello from the fake agent' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { tokens: { input: 5, output: 5 } } }));
process.exit(0);
`;

async function withFakeAgentBin<T>(binName: string, script: string, run: () => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'od-routing-engagement-bin-'));
  const oldPath = process.env.PATH;
  try {
    const bin = join(dir, binName);
    await fsp.writeFile(bin, `#!/usr/bin/env node\n${script}`);
    await fsp.chmod(bin, 0o755);
    process.env.PATH = `${dir}${delimiter}${oldPath ?? ''}`;
    return await run();
  } finally {
    process.env.PATH = oldPath;
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** Reads the row the daemon really persisted, as columns -- deliberately
 * `SELECT *` rather than the typed read path, so the assertion is about what
 * the TABLE stores, not about what a DTO happens to project. */
function storedTelemetryColumns(runId: string): Record<string, unknown> {
  const dataDir = process.env.OD_DATA_DIR;
  if (!dataDir) throw new Error('OD_DATA_DIR is required to read the routing_telemetry table directly');
  const sqlite = new Database(resolve(dataDir, 'app.sqlite'), { readonly: true });
  try {
    const rows = sqlite.prepare(`SELECT * FROM routing_telemetry WHERE run_id = ?`).all(runId) as Array<
      Record<string, unknown>
    >;
    expect(rows, `exactly one routing_telemetry row per dispatch (run ${runId})`).toHaveLength(1);
    return rows[0]!;
  } finally {
    sqlite.close();
  }
}

describe('/api/chat records whether routing engaged', () => {
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
    const projectId = `proj-routing-engagement-${randomUUID()}`;
    const response = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: projectId,
        name: 'Routing engagement red spec fixture',
        skillId: null,
        designSystemId: null,
      }),
    });
    expect(response.status).toBe(200);
    return projectId;
  }

  async function runChat(
    agentId: string,
    binName: string,
    script: string,
    projectId: string,
    conversationId: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const text = await withFakeAgentBin(binName, script, async () => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, projectId, conversationId, message: 'hello', ...body }),
      });
      expect(response.ok).toBe(true);
      return response.text();
    });
    expect(text).toContain('"status":"succeeded"');
  }

  async function runIdFor(conversationId: string): Promise<string> {
    const response = await fetch(`${baseUrl}/api/runs?conversationId=${encodeURIComponent(conversationId)}`);
    const body = (await response.json()) as { runs: Array<{ id: string; status: string }> };
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]!.status).toBe('succeeded');
    return body.runs[0]!.id;
  }

  it('states ENGAGED on the stored row when an explicit routingOverride resolved a vetted lane', async () => {
    const projectId = await createProject();
    const conversationId = `conv-engagement-override-${randomUUID()}`;
    await runChat('claude', 'claude', CLAUDE_SUCCESS_SCRIPT, projectId, conversationId, {
      routingOverride: {
        model: 'claude-haiku-4-5',
        lane: 'claude-code-oauth',
        reason: 'routing engagement red spec',
      },
    });

    const row = storedTelemetryColumns(await runIdFor(conversationId));

    expect(
      Object.keys(row),
      'a stored routing_telemetry row must state whether the router engaged for that dispatch; ' +
        `columns present: ${JSON.stringify(Object.keys(row))}`,
    ).toContain('routing_engagement');
    expect(row.routed_lane).toBe('claude-code-oauth');
    expect(
      row.routing_engagement,
      'an override resolved through the policy engine IS the router engaging',
    ).toBe('engaged');
  });

  it('states RUNTIME-DEFAULT on the stored row when no override or task class engaged the router', async () => {
    const projectId = await createProject();
    const conversationId = `conv-engagement-default-${randomUUID()}`;
    await runChat('opencode', 'opencode', OPENCODE_SUCCESS_SCRIPT, projectId, conversationId, {});

    const row = storedTelemetryColumns(await runIdFor(conversationId));

    expect(
      Object.keys(row),
      'a stored routing_telemetry row must state whether the router engaged for that dispatch; ' +
        `columns present: ${JSON.stringify(Object.keys(row))}`,
    ).toContain('routing_engagement');
    expect(row.routed_lane).toBe('runtime-default');
    expect(
      row.routing_engagement,
      'WR-routing.md Fallback B kept the runtime default -- the router did not engage',
    ).toBe('runtime-default');
  });
});
