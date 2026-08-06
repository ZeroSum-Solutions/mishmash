// Dispatch-time routing integration -- SERVER-LEVEL coverage (WR wave, P2
// tranche, t9 -- plan docs/plans/2026-08-05-model-routing-system.md §3.1
// binding point). apps/daemon/tests/routing-dispatch.test.ts already covers
// apps/daemon/src/routing/dispatch.ts's pure functions directly; THIS file
// proves the additive server.ts wiring (startChatRun's pre-spawn
// resolveDispatchRouting/recordDispatchIntent hook + onRunFinished's
// reconcilePostRun hook) actually fires on a REAL POST /api/chat request
// through a REAL booted daemon (`startServer`), the same pattern
// chat-route.test.ts already establishes (PATH-overlaid fake agent binary,
// no mocks/ replay corpus needed for a plain success run).
//
// Four round trips:
//   1. An explicit `routingOverride` naming a REAL (model, lane) pair the
//      shipped routing-policy.json actually vets for runtime 'claude'
//      (claude-haiku-4-5 / claude-code-oauth, the 'mechanical-batch' row) --
//      proves 'override' mode reaches the wire, vetted (HIGH-2) and
//      same-runtime (HIGH-1), end to end over HTTP.
//   2. A plain request with no override (proves WR-routing.md Fallback B's
//      'runtime-default' mode -- the ONLY mode a real /api/chat request can
//      reach today without an override, since ChatRequest carries no
//      templateId/buildClass/taskClass; see dispatch.ts's own header for the
//      governance gap this reflects).
//   3. An override naming an unresolvable (model, lane) pair (Sol review
//      MED-4) -- proves a BLOCKED dispatch finalizes the SSE/status stream
//      cleanly (`'failed'`, not stuck `'running'`), never spawns the fake
//      agent binary at all, and never leaves an orphan run row.
//   4. A REAL same-run retry (attempt 0 fails with a cooldown-recordable
//      'upstream_unavailable' category, attempt 1 succeeds) driven through
//      the live daemon's actual retry runtime (apps/daemon/tests/
//      run-retry-runtime.test.ts's `writeFlakyClaude` fixture shape) --
//      proves Sol review MED-5's retry-attempt-boundary reconcilePostRun
//      call (server.ts's `finishWithRetryDecision`) actually records the
//      failed attempt's cooldown BEFORE the retry is scheduled, and MED-6's
//      terminal `onFinalize` reconcile then clears it once the retry
//      succeeds -- in that order, not the reverse.
//
// Round trips 1-2 also assert the pre-spawn ROUTED telemetry row via this
// wave's own GET /api/routing/telemetry, and that the OBSERVED side gets
// filled in once the run reports back (reconcilePostRun).

import type http from 'node:http';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { StoredRoutingTelemetryRow } from '@open-design/contracts';

import { startServer } from '../src/server.js';
import { getCooldownRecord } from '../src/routing/reliability.js';

async function withFakeAgentBin<T>(binName: string, script: string, run: () => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'od-routing-dispatch-bin-'));
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

const OPENCODE_SUCCESS_SCRIPT = `
console.log(JSON.stringify({ type: 'step_start', sessionID: 'routing-dispatch-session' }));
console.log(JSON.stringify({ type: 'text', sessionID: 'routing-dispatch-session', part: { text: 'hello from the fake agent' } }));
console.log(JSON.stringify({ type: 'step_finish', part: { tokens: { input: 5, output: 5 } } }));
process.exit(0);
`;

// Sol review H1 residue: the override server test previously only asserted
// the TELEMETRY row's routedModel, which proves resolveDispatchRouting
// decided correctly but NOT that the decision actually reached the real
// spawn's argv -- a regression in server.ts's `safeModel = ...;
// agentOptions.model = safeModel;` wiring (the exact HIGH-1 bug this fix
// round closed) could silently spawn the runtime's OWN default model while
// telemetry still reported the override, and this test would not catch it.
// This variant of the success script writes its own real invocation argv
// (apps/daemon/src/runtimes/defs/claude.ts's buildArgs pushes `['--model',
// options.model]` onto the real CLI args) to a file the test reads AFTER
// the run finishes, so the assertion is against what the CHILD PROCESS was
// actually invoked with, not against a layer that could diverge from it.
function claudeSuccessScriptRecordingArgv(argvLogPath: string): string {
  return `
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(argvLogPath)}, JSON.stringify(process.argv.slice(2)));
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', model: 'fake-claude-model', session_id: 'routing-dispatch-claude-session' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'text', text: 'hello from the fake claude agent' }], stop_reason: 'end_turn' } }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'routing-dispatch-claude-session', usage: { input_tokens: 5, output_tokens: 5 }, total_cost_usd: 0.001, duration_ms: 10 }) + '\\n');
setTimeout(() => process.exit(0), 20);
`;
}

// Sol review MED-5/MED-6: a STATEFUL fake claude binary -- unlike the two
// scripts above, this one must behave differently across the SAME run's two
// spawns (fail transiently, then succeed on retry). Mirrors apps/daemon/
// tests/run-retry-runtime.test.ts's `writeFlakyClaude` fixture exactly: a
// `HTTP 503` stderr line + exit 1 on the first invocation classifies as
// `upstream_unavailable`/`upstream_5xx` (run-failure-classification.ts),
// which IS in dispatch.ts's `COOLDOWN_RECORDABLE_FAILURE_CATEGORIES` and
// IS retried by run-retry-policy.ts's transient-failure policy; a clean
// stream-json success on the second invocation ends the run 'succeeded'.
// A counter file on disk (not a closure variable -- each invocation is a
// separate process) tracks which attempt this is.
async function withFlakyClaudeBin<T>(run: () => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(join(tmpdir(), 'od-routing-dispatch-flaky-bin-'));
  const oldPath = process.env.PATH;
  try {
    const bin = join(dir, 'claude');
    const counterPath = join(dir, 'claude-attempts');
    await fsp.writeFile(
      bin,
      `#!/usr/bin/env node
const fs = require('node:fs');
const counterPath = ${JSON.stringify(counterPath)};
if (process.argv.includes('--version')) { console.log('claude-code 1.0.0-cooldown-retry'); process.exit(0); }
if (process.argv.includes('--help')) { console.log('Usage: claude -p'); process.exit(0); }
if (process.argv.includes('auth')) { console.log('Logged in (fixture)'); process.exit(0); }
let attempts = 0;
try { attempts = Number(fs.readFileSync(counterPath, 'utf8')) || 0; } catch {}
fs.writeFileSync(counterPath, String(attempts + 1));
if (attempts === 0) {
  process.stderr.write('HTTP 503 Service Unavailable: upstream provider unavailable before first token.\\n');
  setTimeout(() => process.exit(1), 20);
} else {
  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-cooldown-retry', session_id: 'routing-cooldown-session' }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', content: [{ type: 'text', text: 'Recovered after retry.' }], stop_reason: 'end_turn' } }) + '\\n');
  setTimeout(() => process.exit(0), 20);
}
`,
    );
    await fsp.chmod(bin, 0o755);
    process.env.PATH = `${dir}${delimiter}${oldPath ?? ''}`;
    return await run();
  } finally {
    process.env.PATH = oldPath;
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

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

  // The ENTIRE request/response lifecycle (fetch + draining the SSE body via
  // .text()) must run INSIDE withFakeAgentBin's PATH-scoped callback, not
  // just the fetch() call: fetch() resolves as soon as response headers
  // arrive (design.runs.stream starts the SSE response immediately), while
  // the actual agent spawn/PATH resolution happens ASYNCHRONOUSLY
  // afterward, while the body is still streaming. Resetting PATH right
  // after fetch() resolves (before the body finishes) would race the real
  // spawn attempt off of PATH entirely.
  async function runChat(
    agentId: string,
    binName: string,
    script: string,
    projectId: string,
    conversationId: string,
    body: Record<string, unknown>,
  ): Promise<string> {
    return withFakeAgentBin(binName, script, async () => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // A `projectId` is REQUIRED for server.ts's onRunFinished hook (usage
        // tracking AND this wave's reconcilePostRun addition both live behind
        // its `if (!run.projectId || !run.id) return;` guard) to run at all.
        body: JSON.stringify({ agentId, projectId, conversationId, message: 'hello', ...body }),
      });
      expect(response.ok).toBe(true);
      return response.text();
    });
  }

  async function getRunRow(conversationId: string): Promise<{ id: string; status: string; errorCode: string | null }> {
    const runsResponse = await fetch(`${baseUrl}/api/runs?conversationId=${encodeURIComponent(conversationId)}`);
    const runsBody = (await runsResponse.json()) as {
      runs: Array<{ id: string; status: string; errorCode: string | null }>;
    };
    expect(runsBody.runs).toHaveLength(1);
    return runsBody.runs[0]!;
  }

  it('records a routed-vs-observed telemetry row for an explicit routingOverride naming a REAL, vetted (model, lane) pair, end to end over HTTP', async () => {
    const projectId = await createProject();
    const conversationId = `conv-routing-override-${randomUUID()}`;
    const argvLogDir = await fsp.mkdtemp(join(tmpdir(), 'od-routing-dispatch-argv-'));
    const argvLogPath = join(argvLogDir, 'claude-argv.json');
    let text: string;
    try {
      text = await runChat(
        'claude',
        'claude',
        claudeSuccessScriptRecordingArgv(argvLogPath),
        projectId,
        conversationId,
        {
          // claude-haiku-4-5 / claude-code-oauth is the shipped policy's
          // 'mechanical-batch' row primary -- a REAL candidate with runtimeId
          // 'claude', matching this request's own agentId (HIGH-1's same-
          // runtime requirement) and passing §15/allowlist/admission (HIGH-2).
          routingOverride: { model: 'claude-haiku-4-5', lane: 'claude-code-oauth', reason: 'server-level override test' },
        },
      );
      expect(text).toContain('"status":"succeeded"');

      // Sol review H1 residue: assert the REAL spawn's argv, not telemetry --
      // the fake agent recorded exactly what it was invoked with.
      const spawnedArgv = JSON.parse(await fsp.readFile(argvLogPath, 'utf8')) as string[];
      const modelFlagIndex = spawnedArgv.indexOf('--model');
      expect(modelFlagIndex).toBeGreaterThanOrEqual(0);
      expect(spawnedArgv[modelFlagIndex + 1]).toBe('claude-haiku-4-5');
    } finally {
      await fsp.rm(argvLogDir, { recursive: true, force: true });
    }

    const run = await getRunRow(conversationId);
    expect(run.status).toBe('succeeded');

    const telemetryResponse = await fetch(`${baseUrl}/api/routing/telemetry?runId=${encodeURIComponent(run.id)}`);
    expect(telemetryResponse.status).toBe(200);
    const telemetryBody = (await telemetryResponse.json()) as { rows: StoredRoutingTelemetryRow[] };
    expect(telemetryBody.rows).toHaveLength(1);
    const row = telemetryBody.rows[0]!;
    // Pre-spawn ROUTED side: the vetted override, not the claude runtime default.
    expect(row.routedModel).toBe('claude-haiku-4-5');
    expect(row.routedLane).toBe('claude-code-oauth');
    // Post-run OBSERVED side: reconcilePostRun (server.ts's onRunFinished
    // hook) filled it in once the run reported back.
    expect(row.observedModel).not.toBeNull();
  });

  it('records a runtime-default telemetry row for a plain chat request with no override or taskClass (WR-routing.md Fallback B)', async () => {
    const projectId = await createProject();
    const conversationId = `conv-routing-default-${randomUUID()}`;
    const text = await runChat('opencode', 'opencode', OPENCODE_SUCCESS_SCRIPT, projectId, conversationId, {});
    expect(text).toContain('"status":"succeeded"');
    const run = await getRunRow(conversationId);
    expect(run.status).toBe('succeeded');

    const telemetryResponse = await fetch(`${baseUrl}/api/routing/telemetry?runId=${encodeURIComponent(run.id)}`);
    expect(telemetryResponse.status).toBe(200);
    const telemetryBody = (await telemetryResponse.json()) as { rows: StoredRoutingTelemetryRow[] };
    expect(telemetryBody.rows).toHaveLength(1);
    const row = telemetryBody.rows[0]!;
    expect(row.routedLane).toBe('runtime-default');
    expect(row.stage).toBe('chat');
  });

  // Sol review MED-4: a blocked dispatch must finalize the SSE/status
  // stream CLEANLY -- 'failed', not stuck 'running' or orphaned -- and must
  // never spawn the underlying agent binary at all. The opencode fake agent
  // is registered on PATH but its distinguishing success marker
  // ('hello from the fake agent') must never appear anywhere in the
  // response, proving the spawn never happened.
  it('a BLOCKED dispatch (unresolvable override) finalizes cleanly with no spawn and no orphan run row', async () => {
    const projectId = await createProject();
    const conversationId = `conv-routing-blocked-${randomUUID()}`;
    const text = await runChat('opencode', 'opencode', OPENCODE_SUCCESS_SCRIPT, projectId, conversationId, {
      routingOverride: { model: 'totally-unrecognized-model-xyz', lane: 'openrouter', reason: 'test' },
    });
    expect(text).not.toContain('hello from the fake agent');
    expect(text).toContain('"status":"failed"');
    expect(text).toContain('FORBIDDEN');

    const run = await getRunRow(conversationId);
    expect(run.status).toBe('failed');
    expect(run.errorCode).toBe('FORBIDDEN');

    // No routed telemetry intent was ever recorded for a blocked dispatch.
    const telemetryResponse = await fetch(`${baseUrl}/api/routing/telemetry?runId=${encodeURIComponent(run.id)}`);
    const telemetryBody = (await telemetryResponse.json()) as { rows: StoredRoutingTelemetryRow[] };
    expect(telemetryBody.rows).toHaveLength(0);
  });

  // Sol review MED-5 + MED-6, end to end: attempt 0 fails with a
  // cooldown-recordable category, the daemon's real same-run retry runtime
  // (run-retry-runtime.test.ts's own territory, reused here for the routing
  // side effect it drives) restarts the SAME run as attempt 1, and attempt 1
  // succeeds. Asserts the cooldown was RECORDED while attempt 1's backoff was
  // in flight (a background poll racing the request, not just the final
  // state -- proving the MED-5 retry-boundary call actually fired, not just
  // that the MED-6 terminal call cleared a cooldown that never existed) and
  // is CLEARED by the time the run finishes -- in that order.
  it('a retried run records a failure cooldown on its failed attempt, then clears it once the retry succeeds', async () => {
    if (!process.env.OD_DATA_DIR) {
      throw new Error('OD_DATA_DIR is required to read the cooldowns table directly');
    }
    const dbFile = resolve(process.env.OD_DATA_DIR, 'app.sqlite');
    const sqlite = new Database(dbFile);
    try {
      const projectId = await createProject();
      const conversationId = `conv-routing-cooldown-retry-${randomUUID()}`;

      let sawRecordedDuringRetry = false;
      const pollForRecordedCooldown = (async () => {
        const deadline = Date.now() + 8_000;
        while (Date.now() < deadline && !sawRecordedDuringRetry) {
          const record = getCooldownRecord(sqlite, 'runtime', 'claude');
          if (record && record.consecutiveFailures > 0) {
            sawRecordedDuringRetry = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 25));
        }
      })();

      const text = await withFlakyClaudeBin(async () => {
        const response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId: 'claude', projectId, conversationId, message: 'hello' }),
        });
        expect(response.ok).toBe(true);
        return response.text();
      });
      await pollForRecordedCooldown;

      expect(text).toContain('"status":"succeeded"');
      const run = await getRunRow(conversationId);
      expect(run.status).toBe('succeeded');

      // Two attempts, two telemetry rows: attempt 0's pre-spawn intent (the
      // one whose failure the MED-5 boundary call recorded) and attempt 1's
      // (the one whose success the MED-6 terminal call reconciled).
      const telemetryResponse = await fetch(`${baseUrl}/api/routing/telemetry?runId=${encodeURIComponent(run.id)}`);
      const telemetryBody = (await telemetryResponse.json()) as { rows: StoredRoutingTelemetryRow[] };
      expect(telemetryBody.rows.length).toBeGreaterThanOrEqual(2);

      expect(sawRecordedDuringRetry).toBe(true);
      const finalRecord = getCooldownRecord(sqlite, 'runtime', 'claude');
      expect(finalRecord?.consecutiveFailures ?? 0).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});
